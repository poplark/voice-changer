import { EventEmitter } from 'events';
import { Middleware } from './middleware/types';
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

  start(): Changer {
    this.midNode = this.srcNode;
    this.middleware.forEach((md) => {
      this.midNode = md(this.ctx, this.midNode);
    });
    this.midNode.connect(this.destNode);
    this.ctx.resume();
    this.emit('start');
    return this;
  }

  play(audio: HTMLAudioElement): Promise<void> {
    audio.srcObject = this.destNode.stream;
    return audio.play();
  }

  getAudioTrack(): MediaStreamTrack {
    const { stream } = this.destNode;
    return stream.getAudioTracks()[0];
  }

  close(): Changer {
    this.ctx.close();

    this.emit('end');
    return this;
  }
}
