import { Middleware } from './types';

function gain(ctx: AudioContext, source: AudioNode, volume: number): AudioNode {
  const gainNode: GainNode = ctx.createGain();
  gainNode.gain.value = volume / 100;
  source.connect(gainNode);
  return gainNode;
}

/**
 * 创建一个有增益作用的中间件
 * @param volume - 增益大小，如 10, 100, 200，分别代表 10%, 100%, 200%
 */
export function createGain(volume: number): Middleware {
  return function (ctx: AudioContext, source: AudioNode): AudioNode {
    return gain(ctx, source, volume);
  };
}
