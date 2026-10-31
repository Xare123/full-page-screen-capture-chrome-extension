// Lifecycle adapter for Tesseract's otherwise private initializing worker.
// This lets cancellation/failure stop acquisition before createWorker resolves.
module.exports = ({ workerPath, onWorker }) => {
  const worker = new Worker(workerPath);
  onWorker?.(worker);
  return worker;
};
