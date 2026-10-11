import assert from 'node:assert/strict';
import test from 'node:test';
import { FpsMeter, measureFps, MIN_FPS, pickConfig, processingSize, RecoveryController, rgbaToRgb, TARGET_FPS, CAMERA_LADDER, type PipelineSample, type RecoveryAction } from '../src/features/insights/cameraPipeline.js';
import { MonitoringService, rollingFps, type PresageModule } from '../server/physiology.js';

/** Capture timestamps (ms) for a camera running at `fps`, with ±`jitter` ms of timing noise. */
const stamps = (fps: number, seconds: number, jitter = 3, start = 1_000) =>
  Array.from({ length: Math.round(fps * seconds) }, (_, index) => start + (index * 1000) / fps + (index % 2 ? jitter : -jitter));

test('frame rate is measured from capture timestamps at 15, 20, 25 and 30 fps', () => {
  for (const fps of [15, 20, 25, 30]) assert.ok(Math.abs(measureFps(stamps(fps, 2))! - fps) < 0.6, `${fps} fps`);
  assert.equal(measureFps([1, 2, 3]), undefined, 'too few frames to judge');
  const meter = new FpsMeter();
  // 30 fps with every 6th frame lost upstream.
  stamps(30, 3, 0).filter((_, index) => index % 6 !== 5).forEach((at) => meter.push(at));
  assert.ok(meter.fps()! < 26 && meter.fps()! > 24);
  assert.ok(meter.missed >= 12, `missed ${meter.missed}`);
});

test('camera configuration is chosen by measured, not advertised, rate', () => {
  const [hd, vga, wide, small] = CAMERA_LADDER as [typeof CAMERA_LADDER[0], typeof CAMERA_LADDER[0], typeof CAMERA_LADDER[0], typeof CAMERA_LADDER[0]];
  const probe = (config: typeof vga, fps?: number) => ({ config, fps, width: config.width, height: config.height });
  assert.equal(pickConfig([probe(vga, 29.6)])?.config, vga);
  assert.equal(pickConfig([probe(vga, 18), probe(hd, 27)])?.config, hd, 'tries further before settling');
  assert.equal(pickConfig([probe(hd, 15), probe(vga, 26), probe(wide, 25.5), probe(small, 21)])?.config, vga, 'between 25 and the target: fastest usable camera is still tried');
  assert.equal(pickConfig([probe(hd, 15), probe(vga, 24), probe(wide, 22)]), undefined, 'below 25 fps Presage reports FRAME_RATE_TOO_LOW, so nothing is sent');
  assert.equal(pickConfig([probe(vga, 8), probe(hd, undefined), probe(small, 11)]), undefined, `nothing reaches ${MIN_FPS} fps`);
});

test('frames are downsized in proportion and converted without per-byte overhead', () => {
  assert.deepEqual(processingSize(640, 480, 480), { width: 480, height: 360 });
  assert.deepEqual(processingSize(1280, 720, 480), { width: 480, height: 270 });
  assert.deepEqual(processingSize(320, 240, 480), { width: 320, height: 240 });
  const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual([...rgbaToRgb(rgba, new Uint8Array(6))], [1, 2, 3, 4, 5, 6]);
});

/** Runs the controller once per second over a scripted camera. */
function run(seconds: number, sample: (t: number) => Partial<PipelineSample>, state = { canLowerCapture: true, canLowerProcessing: true }, onAction?: (action: RecoveryAction) => void) {
  const controller = new RecoveryController(); const actions: { t: number; action: RecoveryAction }[] = [];
  for (let t = 1; t <= seconds; t++) {
    const action = controller.evaluate({ elapsedMs: t * 1000, queueDrops: 0, validReadings: 0, ...sample(t) }, state);
    if (action.kind !== 'none') { actions.push({ t, action }); onAction?.(action); }
  }
  return { actions, controller };
}

test('recovery: 30 and 25 fps cameras run untouched', () => {
  for (const fps of [30, 25]) assert.deepEqual(run(60, () => ({ captureFps: fps, deliveredFps: fps, code: 'OK' })).actions, [], `${fps} fps`);
  assert.equal(TARGET_FPS, 30); assert.equal(MIN_FPS, 25);
});

test('recovery: a sustained 20 fps camera steps down resolution; a momentary dip does not', () => {
  const { actions, controller } = run(20, () => ({ captureFps: 20, deliveredFps: 20 }));
  assert.equal(actions[0]?.action.kind, 'lower_capture');
  assert.ok(actions[0]!.t >= 6, 'waits for a sustained drop');
  assert.match(controller.advice!, /about 20 fps.*light/);
  assert.deepEqual(run(30, (t) => ({ captureFps: t >= 10 && t < 13 ? 17 : 30, deliveredFps: 30 })).actions, [], 'a 3-second dip is ignored');
});

test('recovery: with no lower setting left, Presage decides; usable cameras continue and honest failures stop', () => {
  const exhausted = { canLowerCapture: false, canLowerProcessing: false };
  // 20 fps but Presage accepts the stream and readings keep arriving.
  assert.deepEqual(run(90, (t) => ({ captureFps: 20, code: 'OK', validReadings: t }), exhausted).actions.map((entry) => entry.action.kind), []);
  // 15 fps and Presage keeps reporting FRAME_RATE_TOO_LOW with no reliable readings.
  const slow = run(90, () => ({ captureFps: 15, code: 'FRAME_RATE_TOO_LOW', validReadings: 0 }), exhausted);
  assert.equal(slow.actions[0]?.action.kind, 'give_up');
  assert.match((slow.actions[0]!.action as { reason: string }).reason, /too low.*15 fps/);
  // Below the floor, stop without waiting for 30 s of validation.
  const tiny = run(30, () => ({ captureFps: 9 }), exhausted);
  assert.equal(tiny.actions[0]?.action.kind, 'give_up');
  assert.ok(tiny.actions[0]!.t < 15);
});

test('recovery: frames lost after capture lower the processing size instead of the camera', () => {
  const { actions, controller } = run(20, () => ({ captureFps: 30, deliveredFps: 18, queueDrops: 4 }));
  assert.equal(actions[0]?.action.kind, 'lower_processing');
  assert.match(controller.advice!, /lost after capture/);
});

class FakeSdk {
  static last?: FakeSdk;
  handlers: Record<string, (...args: never[]) => void> = {};
  frames: number[] = []; sizes: string[] = [];
  constructor() { FakeSdk.last = this; }
  useCustomInput() { return this; }
  start() {}
  stop() {}
  async destroy() {}
  sendFrame(buffer: Uint8Array, width: number, height: number, stride: number, _format: number, timestampUs: number) {
    assert.equal(buffer.length, stride * height); this.frames.push(timestampUs); this.sizes.push(`${width}x${height}`);
    // Presage reports each frame as consumed.
    (this.handlers.frameSentThrough as unknown as (sent: boolean, ts: number) => void)?.(true, timestampUs);
    return true;
  }
  on(event: string, callback: (...args: never[]) => void) { this.handlers[event] = callback; return this; }
}
const fakeModule: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => ({}) };
const batch = (timestampsUs: number[], width: number, height: number) => {
  const stride = 8 + width * height * 3; const body = Buffer.alloc(stride * timestampsUs.length);
  timestampsUs.forEach((timestamp, index) => body.writeDoubleLE(timestamp, index * stride));
  return body;
};

test('server ingestion keeps capture order, measures delivered and processed rates, and rejects nothing silently', async () => {
  for (const fps of [15, 20, 25, 30]) {
    const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => fakeModule });
    const window = await service.start('s', 'in_session');
    const origin = Date.now() * 1000;
    const times = stamps(fps, 3, 0, 0).map((ms) => origin + Math.round(ms * 1000));
    let status;
    for (let index = 0; index < times.length; index += 6) status = service.ingest('s', window.id, batch(times.slice(index, index + 6), 96, 72), 96, 72, fps);
    assert.ok(Math.abs(status!.pipeline!.deliveredFps! - fps) < 0.6, `delivered ${status!.pipeline!.deliveredFps} at ${fps} fps`);
    assert.equal(status!.pipeline!.captureFps, fps);
    assert.ok(status!.pipeline!.processedFps! > 0, 'processing rate comes from frameSentThrough');
    assert.deepEqual(FakeSdk.last!.frames, times, 'every frame reached Presage once, in order, with its original timestamp');
    // A late duplicate batch is counted, not re-timed.
    const late = service.ingest('s', window.id, batch([times[3]!, times[4]!], 96, 72), 96, 72);
    assert.equal(late.pipeline!.outOfOrder, 2);
    assert.equal(FakeSdk.last!.frames.length, times.length);
    service.close();
  }
});

test('processing sizes up to 640×480 are accepted, larger frames are rejected, and a slow camera ends honestly', async () => {
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => fakeModule });
  const window = await service.start('s', 'in_session');
  const now = Date.now() * 1000;
  service.ingest('s', window.id, batch([now], 480, 360), 480, 360);
  service.ingest('s', window.id, batch([now + 33_000], 480, 270), 480, 270);
  assert.deepEqual(FakeSdk.last!.sizes, ['480x360', '480x270'], 'size changes between batches are allowed');
  assert.throws(() => service.ingest('s', window.id, batch([now + 66_000], 800, 600), 800, 600), /Frame size/);
  const stopped = await service.stop('s', window.id, 'camera_too_slow');
  assert.equal(stopped.window.status, 'error');
  assert.match(stopped.window.endReason!, /could not keep a frame rate.*continues without camera insights/);
  assert.equal(stopped.window.samples.length, 0, 'no readings are invented for a slow camera');
  service.close();
});

test('rolling rates ignore stale frames', () => {
  const times = [0, 33, 66, 100, 133, 10_000, 10_033, 10_066, 10_100, 10_133];
  assert.ok(Math.abs(rollingFps(times, 10_133)! - 30) < 1);
  assert.equal(times[0], 10_000);
});

test('sendFrame refusals are counted, never treated as accepted, and a persistent refusal ends the window with a reason', async () => {
  class RefusingSdk extends FakeSdk { sendFrame() { return false; } }
  const module: PresageModule = { SmartSpectraSDK: RefusingSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => ({}) };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  const window = await service.start('s', 'in_session');
  const origin = Date.now() * 1000;
  const status = service.ingest('s', window.id, batch(Array.from({ length: 8 }, (_, index) => origin + index * 33_000), 96, 72), 96, 72);
  assert.equal(status.pipeline!.received, 8);
  assert.equal(status.pipeline!.rejected, 8);
  assert.equal(status.pipeline!.accepted, 0);
  assert.equal(status.window.framesReceived, 0, 'refused frames are not counted as received by Presage');
  assert.equal(status.code, 'FRAMES_REJECTED');
  service.close();
});

test('metrics that cannot be decoded are counted and reported, not dropped silently', async () => {
  const module: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => { throw new Error('bad wire format'); } };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  const window = await service.start('s', 'in_session');
  (FakeSdk.last!.handlers.metrics as unknown as (buffer: Buffer) => void)(Buffer.from([1, 2, 3]));
  const status = service.ingest('s', window.id, batch([Date.now() * 1000], 96, 72), 96, 72);
  assert.equal(status.presage!.metricsPackets, 1);
  assert.equal(status.presage!.decodeErrors, 1);
  assert.match(status.presage!.lastDecodeError!, /bad wire format/);
  service.close();
});
