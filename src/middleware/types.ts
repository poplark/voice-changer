export interface Middleware {
  (ctx: AudioContext, source: AudioNode): AudioNode;
}
