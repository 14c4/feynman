/*
 * Encodes camera frames to JPEG off the main thread. On the main thread, canvas JPEG encoding
 * competes with the on-device face tracker and falls to a few frames per second, far below the
 * 25 fps Presage needs. Jobs are handled strictly in order, so frames come back in capture order.
 */

interface EncodeJob { id: number; frame: VideoFrame; width: number; height: number; quality: number }
interface WorkerScope { onmessage: ((event: MessageEvent<EncodeJob>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }

const scope = self as unknown as WorkerScope;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;
let chain: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const { id, frame, width, height, quality } = event.data;
  chain = chain.then(async () => {
    try {
      if (!canvas || canvas.width !== width || canvas.height !== height) { canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d'); }
      if (!context) throw new Error('No 2D context in the worker.');
      context.drawImage(frame, 0, 0, width, height);
      const buffer = await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer();
      scope.postMessage({ id, buffer }, [buffer]);
    } catch { scope.postMessage({ id }); } finally { frame.close(); }
  });
};
