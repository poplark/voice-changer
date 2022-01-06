import workletBody from 'raw-loader!babel-loader!./worklet.js';

/**
 * 白噪声 Processor 的加载地址
 * @internal
 */
export const WhiteNoiseProcessorURL = URL.createObjectURL(new Blob([workletBody], { type: 'text/javascript' }));

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
