import { EventEmitter } from 'events';
import { Middleware } from './middleware/types';
import { getProcessorURL, releaseProcessorURL } from './middleware/white-noise';

/**
 * @internal
 */
const AudioContextClass = (window.AudioContext ||
  (window as any).webkitAudioContext ||
  (window as any).mozAudioContext ||
  (window as any).msAudioContext ||
  (window as any).oAudioContext) as typeof AudioContext;

export class Changer extends EventEmitter {
  private ctx: AudioContext;
  private srcNode: MediaStreamAudioSourceNode;
  private midNode: AudioNode;
  private destNode: MediaStreamAudioDestinationNode;
  private middleware: Middleware[] = [];

  constructor() {
    super();
    this.ctx = new AudioContextClass();
    this.ctx.audioWorklet
      .addModule(getProcessorURL())
      // .addModule(new URL('./worklet/white-noise.worklet.js', import.meta.url))
      .then(() => {
        console.log('loaded processor');
      })
      .catch((err) => {
        console.log('load processor failed', err);
      })
      .finally(() => {
        releaseProcessorURL();
      });
  }

  use(md: Middleware): Changer {
    this.middleware.push(md);
    return this;
  }

  input(source: MediaStreamTrack): Changer {
    const ms = new MediaStream();
    ms.addTrack(source);
    this.srcNode = this.ctx.createMediaStreamSource(ms);
    this.destNode = this.ctx.createMediaStreamDestination();
    return this;
  }

  start(): Promise<void> {
    if (this.ctx.state === 'closed') {
      console.warn('The changer was closed');
      return Promise.reject(new Error('The changer was closed'));
    }
    if (this.midNode) {
      console.warn('The changer has already started');
      return Promise.reject(new Error('The changer has already started'));
    }
    this.midNode = this.srcNode;
    this.middleware.forEach((md) => {
      this.midNode = md(this.ctx, this.midNode);
    });
    this.midNode.connect(this.destNode);
    this.emit('start');
    return this.ctx.resume();
  }

  play(audio: HTMLAudioElement): Promise<void> {
    audio.srcObject = this.destNode.stream;
    return audio.play();
  }

  getAudioTrack(): MediaStreamTrack {
    const { stream } = this.destNode;
    return stream.getAudioTracks()[0];
  }

  close(): Promise<void> {
    this.emit('end');
    return this.ctx.close();
  }

  pause(): Promise<void> {
    return this.ctx.suspend();
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }
}
