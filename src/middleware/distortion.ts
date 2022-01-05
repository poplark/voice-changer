import { Middleware } from './types';

function makeDistortionCurve(amount: number): Float32Array {
  const k = typeof amount === 'number' ? amount : 50,
    n_samples = 48000,
    curve = new Float32Array(n_samples),
    deg = Math.PI / 180;
  let i = 0,
    x: number;
  for (; i < n_samples; ++i) {
    x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function distortion(ctx: AudioContext, source: AudioNode, amount: number): AudioNode {
  const distortion = ctx.createWaveShaper();
  distortion.curve = makeDistortionCurve(amount);
  source.connect(distortion);
  return distortion;
}

/**
 * 创建一个使声音失真作用的中间件
 * @param amount - 失真程度
 */
export function createDistortion(amount: number): Middleware {
  return function (ctx: AudioContext, source: AudioNode): AudioNode {
    return distortion(ctx, source, amount);
  };
}
