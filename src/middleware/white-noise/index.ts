import workletBody from 'raw-loader!babel-loader!./worklet.js';

/**
 * 白噪声 Processor 的加载地址
 * @internal
 */
let WhiteNoiseProcessorURL = '';

/**
 * 获取白噪声 Processor 的加载地址
 * @internal
 */
export function getProcessorURL(): string {
  if (WhiteNoiseProcessorURL) {
    return WhiteNoiseProcessorURL;
  }
  WhiteNoiseProcessorURL = URL.createObjectURL(new Blob([workletBody], { type: 'text/javascript' }));
  return WhiteNoiseProcessorURL;
}

/**
 * 释放白噪声 Processor 的加载地址
 * @internal
 */
export function releaseProcessorURL(): void {
  URL.revokeObjectURL(WhiteNoiseProcessorURL);
  WhiteNoiseProcessorURL = '';
}

/**
 * 白噪声作用的中间件
 * @param ctx -
 * @param source -
 * @returns
 */
export function whiteNoise(ctx: AudioContext, source: AudioNode): AudioNode {
  const whiteNoiseNode = new AudioWorkletNode(ctx, 'white-noise-processor');
  source.connect(whiteNoiseNode);
  return whiteNoiseNode;
}
