import assert from 'node:assert/strict';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { packBatch, type EncodedFrame } from '../src/features/insights/cameraPipeline.js';
import { coverMapping, framingFor, GHOST_HIDE_AFTER_MS, GHOST_SHOW_AFTER_MS, ghostVisible, presageStage, smoothBox, squareAround, type StageInput } from '../src/features/insights/faceGeometry.js';
import { faceFromMetrics, hrvFromMetrics, isoAt, MonitoringService, type PresageModule } from '../server/physiology.js';

test('the tracking square is square on screen, centred on the face, and steady against jitter', () => {
  const aspect = 4 / 3;
  const box = squareAround({ x: 0.4, y: 0.3, w: 0.15, h: 0.3 }, aspect);
  assert.ok(Math.abs(box.w * aspect - box.h) < 1e-9, 'equal sides in pixels');
  assert.ok(Math.abs(box.x + box.w / 2 - 0.475) < 1e-9 && Math.abs(box.y + box.h / 2 - 0.45) < 1e-9, 'centred on the face');
  assert.deepEqual(smoothBox(box, { ...box, x: box.x + 0.001 }), box, 'sub-deadband jitter is ignored');
  const moved = smoothBox(box, { ...box, x: box.x + 0.05 });
  assert.ok(moved.x > box.x && moved.x < box.x + 0.05, 'real movement is followed smoothly');
  const jumped = { ...box, x: box.x + 0.6 };
  assert.deepEqual(smoothBox(box, jumped), jumped, 'a re-acquired face snaps instead of sliding across');
  // 640×480 frame shown in a 300×300 cover element: cropped left and right equally.
  const map = coverMapping(640, 480, 300, 300);
  assert.equal(map.x(0.5), 150); assert.equal(map.y(0), 0); assert.equal(map.width, 400);
});

test('framing hints come from the detected face box and measured brightness', () => {
  // A relaxed head-and-shoulders shot: face in the upper middle, shoulders below.
  const centred = { x: 0.4, y: 0.22, w: 0.2, h: 0.28 };
  assert.equal(framingFor({ faces: 1, bounds: centred, brightness: 120 }).code, 'ok');
  assert.equal(framingFor({ faces: 2, bounds: centred }).code, 'multiple');
  assert.equal(framingFor({ faces: 1, bounds: centred, brightness: 30 }).code, 'too_dark');
  assert.equal(framingFor({ faces: 1, bounds: { ...centred, h: 0.1 } }).code, 'too_far');
  assert.equal(framingFor({ faces: 1, bounds: { ...centred, y: 0.1, h: 0.6 } }).code, 'too_close');
  assert.equal(framingFor({ faces: 1, bounds: { ...centred, y: 0.5 } }).code, 'too_low');
  assert.equal(framingFor({ faces: 1, bounds: { ...centred, y: 0.0 } }).code, 'too_high');
  // Wide tolerance: leaning, slouching a little or sitting further back all still count as framed.
  for (const bounds of [{ ...centred, x: 0.3 }, { ...centred, y: 0.3 }, { ...centred, y: 0.26, h: 0.16 }, { ...centred, y: 0.15, h: 0.36 }])
    assert.equal(framingFor({ faces: 1, bounds }).code, 'ok', JSON.stringify(bounds));
});

test('the head-and-shoulders guide steps aside once framed and returns only for a lasting problem', () => {
  const at = (framedForMs: number, offForMs: number, anyValid = false) => ({ framedForMs, offForMs, anyValid });
  assert.equal(ghostVisible(true, at(0, 2000)), true, 'shown while getting set up');
  assert.equal(ghostVisible(true, at(GHOST_HIDE_AFTER_MS - 1, 0)), true);
  assert.equal(ghostVisible(true, at(GHOST_HIDE_AFTER_MS, 0)), false, 'hidden once framed for a moment');
  assert.equal(ghostVisible(true, at(0, 1000, true)), false, 'a reliable reading already proves the framing works');
  assert.equal(ghostVisible(false, at(0, GHOST_SHOW_AFTER_MS - 1)), false, 'brief movement does not bring it back');
  assert.equal(ghostVisible(false, at(0, GHOST_SHOW_AFTER_MS)), true);
  assert.equal(ghostVisible(true, at(0, GHOST_SHOW_AFTER_MS, true)), true, 'a lasting problem keeps it, even after readings');
});

test('the panel headline follows real signals and treats warm-up as collecting, not failure', () => {
  const base: StageInput = { phase: 'calibrating', simulated: false, camera: true, windowOpen: true, tracker: 'ready', face: 'found', framesReceived: 120, code: 'OK', metricsPackets: 0, freshValid: false, anyValid: false };
  assert.equal(presageStage({ ...base, phase: 'requesting', camera: false, windowOpen: false }).id, 'camera');
  assert.equal(presageStage({ ...base, windowOpen: false }).id, 'loading');
  assert.equal(presageStage({ ...base, framesReceived: 0, code: undefined }).id, 'detected');
  assert.equal(presageStage(base).id, 'tracking');
  assert.equal(presageStage({ ...base, metricsPackets: 4 }).id, 'collecting');
  assert.equal(presageStage({ ...base, metricsPackets: 4, freshValid: true, anyValid: true, phase: 'monitoring' }).id, 'measuring');
  assert.equal(presageStage({ ...base, face: 'none' }).id, 'searching');
  assert.equal(presageStage({ ...base, face: 'none', freshValid: true, anyValid: true }).id, 'measuring', 'Presage’s validated reading outranks a local tracker miss');
  assert.equal(presageStage({ ...base, simulated: true, face: 'none', freshValid: true }).id, 'searching', 'simulated readings never imply a face');
  assert.equal(presageStage({ ...base, face: 'lost' }).id, 'lost');
  assert.equal(presageStage({ ...base, code: 'FACE_NOT_CENTERED' }).id, 'adjust');
  assert.equal(presageStage({ ...base, code: 'CHEST_NOT_VISIBLE' }).id, 'adjust', 'while Presage holds readings back, the learner is told why');
  assert.equal(presageStage({ ...base, code: 'CHEST_NOT_VISIBLE', freshValid: true, anyValid: true }).id, 'measuring', 'once pulse flows, a lingering chest warning is not shown');
  assert.equal(presageStage({ ...base, phase: 'reconnecting', windowOpen: false, camera: false }).id, 'reconnecting');
  assert.equal(presageStage({ ...base, processing: 'error' }).id, 'error');
  // Without the local tracker, Presage's own validation still drives the headline.
  assert.equal(presageStage({ ...base, tracker: 'unavailable', code: 'NO_FACE_FOUND' }).id, 'searching');
  assert.equal(presageStage({ ...base, phase: 'stopping' }).id, 'saving');
});

test('Presage face metrics are normalized to the frame, and HRV is valid only at its published confidence', () => {
  const at = 1_700_000_000_000_000;
  const pixels = faceFromMetrics({ face: { landmarks: [{ value: [{ x: 200, y: 100 }, { x: 280, y: 100 }, { x: 240, y: 200 }], stable: true, timestamp: at }], talking: [{ detected: true, timestamp: at }] } }, 320, 240);
  assert.deepEqual(pixels!.box && Object.values(pixels!.box).map((value) => Math.round(value * 1000) / 1000), [0.625, 0.417, 0.25, 0.417]);
  assert.equal(pixels!.talking, true); assert.equal(pixels!.stable, true);
  assert.equal(pixels!.at, new Date(at / 1000).toISOString());
  const normalized = faceFromMetrics({ face: { landmarks: [{ value: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.6 }] }] } });
  assert.ok(normalized!.box && Math.abs(normalized!.box.w - 0.2) < 1e-9);
  const offFrame = faceFromMetrics({ face: { landmarks: [{ value: [{ x: 900, y: 100 }, { x: 990, y: 100 }, { x: 950, y: 200 }] }] } }, 320, 240);
  assert.equal(offFrame!.box, undefined, 'coordinates that cannot be placed are not drawn');
  assert.equal(faceFromMetrics({ cardio: {} }), undefined);
  assert.equal(hrvFromMetrics({ cardio: { hrv: [{ rmssd: 42.4, confidence: 70 }] } })!.valid, true);
  assert.equal(hrvFromMetrics({ cardio: { hrv: [{ rmssd: 42.4, confidence: 20 }] } })!.valid, false);
  assert.equal(hrvFromMetrics({ cardio: { hrv: [{ rmssd: 0, confidence: 90 }] } }), undefined);
});

class FakeSdk {
  static last?: FakeSdk;
  handlers: Record<string, (...args: never[]) => void> = {};
  frames: number[] = []; sizes: string[] = [];
  constructor(readonly options: { requestedMetrics?: number[] }) { FakeSdk.last = this; }
  useCustomInput() { return this; }
  start() {}
  stop() {}
  async destroy() {}
  sendFrame(buffer: Uint8Array, width: number, height: number, stride: number, _format: number, timestampUs: number) {
    assert.equal(buffer.length, stride * height); this.frames.push(timestampUs); this.sizes.push(`${width}x${height}`);
    return true;
  }
  emit(event: string, ...args: unknown[]) { (this.handlers[event] as unknown as (...values: unknown[]) => void)(...args); }
  on(event: string, callback: (...args: never[]) => void) { this.handlers[event] = callback; return this; }
}

const jpegFrame = (timestampUs: number, width = 96, height = 72): EncodedFrame => {
  const rgba = Buffer.alloc(width * height * 4, 128);
  return { timestampUs, width, height, encoding: 'jpeg', bytes: new Uint8Array(jpeg.encode({ data: rgba, width, height }, 90).data) };
};

test('JPEG batches are decoded in order on the server, and Presage face lock and processing state reach the status', async () => {
  let decoded: unknown = {};
  const module: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => decoded, faceMetrics: [10, 11, 12, 14] };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  const window = await service.start('s', 'in_session');
  const sdk = FakeSdk.last!;
  assert.ok(!sdk.options.requestedMetrics!.some((metric) => [10, 11, 12, 14].includes(metric)), 'face metrics are opt-in, so not requested by default');

  const origin = Date.now() * 1000;
  const times = [0, 33_333, 66_667].map((offset) => origin + offset);
  let status = service.ingest('s', window.id, Buffer.from(packBatch(times.map((time) => jpegFrame(time)))), 96, 72, 30, 'jpeg');
  assert.deepEqual(sdk.frames, times); assert.deepEqual(sdk.sizes, ['96x72', '96x72', '96x72']);
  assert.equal(status.presage!.metricsPackets, 0, 'frames alone are not analysis output');

  sdk.emit('processingStatus', 3);
  decoded = { face: { landmarks: [{ value: [{ x: 30, y: 20 }, { x: 60, y: 20 }, { x: 45, y: 50 }], stable: true, timestamp: times[2] }] }, cardio: { hrv: [{ rmssd: 38, confidence: 64, timestamp: times[2] }] } };
  sdk.emit('metrics', Buffer.alloc(1));
  status = service.ingest('s', window.id, Buffer.from(packBatch([jpegFrame(origin + 100_000)])), 96, 72, 30, 'jpeg');
  assert.equal(status.presage!.processing, 'running');
  assert.equal(status.presage!.metricsPackets, 1);
  assert.ok(status.presage!.face!.box && status.presage!.face!.box.x > 0.3 && status.presage!.face!.box.x < 0.32, 'pixel landmarks normalized by the decoded frame size');
  assert.deepEqual(status.presage!.hrv && [status.presage!.hrv.rmssdMs, status.presage!.hrv.valid], [38, true]);
  assert.ok(status.elapsedMs! >= 99 && status.elapsedMs! <= 101, 'warm-up clock runs on capture time');

  const truncated = Buffer.from(packBatch([jpegFrame(origin + 200_000)])).subarray(0, 40);
  assert.throws(() => service.ingest('s', window.id, truncated, 96, 72, 30, 'jpeg'), /malformed/);
  const corrupt = Buffer.from(packBatch([{ ...jpegFrame(origin + 300_000), bytes: new Uint8Array(64).fill(7) }]));
  assert.throws(() => service.ingest('s', window.id, corrupt, 96, 72, 30, 'jpeg'), /could not be decoded/);
  service.close();
});

test('face metrics are requested only when opted in, and expressions never', async () => {
  const module: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => ({}), faceMetrics: [10, 11, 12, 14] };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k', PRESAGE_FACE_METRICS: 'on' }, loadPresage: async () => module });
  await service.start('s', 'in_session');
  const requested = FakeSdk.last!.options.requestedMetrics!;
  assert.ok([10, 11, 12].every((metric) => requested.includes(metric)) && !requested.includes(14));
  service.close();
});

test('a new Presage session never starts while the previous one is still shutting down', async () => {
  const order: string[] = [];
  let release!: () => void;
  class SlowSdk {
    constructor() { order.push('construct'); }
    useCustomInput() { return this; }
    start() {}
    stop() {}
    destroy() { order.push('destroy:start'); return new Promise<void>((resolve) => { release = () => { order.push('destroy:end'); resolve(); }; }); }
    sendFrame() { return true; }
    on() { return this; }
  }
  const module: PresageModule = { SmartSpectraSDK: SlowSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => ({}) };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  const first = await service.start('s', 'in_session');
  const stopping = service.stop('s', first.id);
  const next = service.start('s', 'in_session');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, ['construct', 'destroy:start'], 'the restart waits for the old session to be destroyed');
  release();
  await stopping; await next;
  assert.deepEqual(order, ['construct', 'destroy:start', 'destroy:end', 'construct']);
  service.close();
});

test('the GPU-only arterial pressure model is never requested', async () => {
  const module: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => ({}), breathingMetrics: [2], cardioMetrics: [15, 16, 17] };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  await service.start('s', 'in_session');
  assert.deepEqual(FakeSdk.last!.options.requestedMetrics, [2, 15, 17], 'phasic-bp-inference needs Vulkan, which servers like Railway lack');
  service.close();
});

test('odd Presage timestamps or a failing handler never crash the server', async () => {
  assert.doesNotThrow(() => isoAt(1e20));
  assert.ok(Number.isFinite(Date.parse(isoAt(Number.NaN))));
  assert.doesNotThrow(() => hrvFromMetrics({ cardio: { hrv: [{ rmssd: 40, confidence: 70, timestamp: 1e30 }] } }));
  let decoded: unknown = { cardio: { pulseRate: [{ value: 72, confidence: 80, stable: true, timestamp: 1e30 }], hrv: [{ rmssd: 40, confidence: 70, timestamp: 1e30 }] } };
  const module: PresageModule = { SmartSpectraSDK: FakeSdk as unknown as PresageModule['SmartSpectraSDK'], decodeMetrics: () => decoded };
  const service = new MonitoringService({ env: { NODE_ENV: 'test', PRESAGE_API_KEY: 'k' }, loadPresage: async () => module });
  const window = await service.start('s', 'in_session');
  const sdk = FakeSdk.last!;
  assert.doesNotThrow(() => sdk.emit('metrics', Buffer.alloc(1)), 'out-of-range timestamps are handled');
  decoded = { face: { landmarks: { not: 'an array' } }, cardio: { hrv: 'garbage' } };
  assert.doesNotThrow(() => sdk.emit('metrics', Buffer.alloc(1)), 'malformed packets are handled');
  assert.doesNotThrow(() => service.ingest('s', window.id, Buffer.from(packBatch([jpegFrame(Date.now() * 1000)])), 96, 72, 30, 'jpeg'));
  service.close();
});
