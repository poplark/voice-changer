const USE_AUTO_SEQUENCE_LEN = 0;
//const DEFAULT_SEQUENCE_MS = 130
const DEFAULT_SEQUENCE_MS = USE_AUTO_SEQUENCE_LEN;
const USE_AUTO_SEEKWINDOW_LEN = 0;
//const DEFAULT_SEEKWINDOW_MS = 25;
const DEFAULT_SEEKWINDOW_MS = USE_AUTO_SEEKWINDOW_LEN;
const DEFAULT_OVERLAP_MS = 8;

// Table for the hierarchical mixing position seeking algorithm
const _SCAN_OFFSETS = [
  [
    124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426,
    1488, 0,
  ],
  [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// Adjust tempo param according to tempo, so that variating processing sequence length is used
// at varius tempo settings, between the given low...top limits
const AUTOSEQ_TEMPO_LOW = 0.5; // auto setting low tempo range (-50%)
const AUTOSEQ_TEMPO_TOP = 2.0; // auto setting top tempo range (+100%)

// sequence-ms setting values at above low & top tempo
const AUTOSEQ_AT_MIN = 125.0;
const AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;

// seek-window-ms setting values at above low & top tempo
const AUTOSEEK_AT_MIN = 25.0;
const AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

function testFloatEqual(a, b) {
  return (a > b ? a - b : b - a) > 1e-10;
}
class FifoSampleBuffer {
  constructor() {
    this._vector = new Float32Array();
    this._position = 0;
    this._frameCount = 0;
  }

  get vector() {
    return this._vector;
  }

  get position() {
    return this._position;
  }

  get startIndex() {
    return this._position * 2;
  }

  get frameCount() {
    return this._frameCount;
  }

  get endIndex() {
    return (this._position + this._frameCount) * 2;
  }

  clear() {
    this.receive(this._frameCount);
    this.rewind();
  }

  put(numFrames) {
    this._frameCount += numFrames;
  }

  putSamples(samples, position, numFrames = 0) {
    position = position || 0;
    const sourceOffset = position * 2;
    if (!(numFrames >= 0)) {
      numFrames = (samples.length - sourceOffset) / 2;
    }
    const numSamples = numFrames * 2;

    this.ensureCapacity(numFrames + this._frameCount);

    const destOffset = this.endIndex;
    this.vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);

    this._frameCount += numFrames;
  }

  putBuffer(buffer, position, numFrames = 0) {
    position = position || 0;
    if (!(numFrames >= 0)) {
      numFrames = buffer.frameCount - position;
    }
    this.putSamples(buffer.vector, buffer.position + position, numFrames);
  }

  receive(numFrames) {
    if (!(numFrames >= 0) || numFrames > this._frameCount) {
      numFrames = this.frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }

  receiveSamples(output, numFrames = 0) {
    const numSamples = numFrames * 2;
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    this.receive(numFrames);
  }

  extract(output, position = 0, numFrames = 0) {
    const sourceOffset = this.startIndex + position * 2;
    const numSamples = numFrames * 2;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
  }

  ensureCapacity(numFrames = 0) {
    const minLength = parseInt(numFrames * 2);
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else {
      this.rewind();
    }
  }

  ensureAdditionalCapacity(numFrames = 0) {
    this.ensureCapacity(this._frameCount + numFrames);
  }

  rewind() {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}
class AbstractFifoSamplePipe {
  constructor(createBuffers) {
    if (createBuffers) {
      this._inputBuffer = new FifoSampleBuffer();
      this._outputBuffer = new FifoSampleBuffer();
    } else {
      this._inputBuffer = this._outputBuffer = null;
    }
  }

  get inputBuffer() {
    return this._inputBuffer;
  }

  set inputBuffer(inputBuffer) {
    this._inputBuffer = inputBuffer;
  }

  get outputBuffer() {
    return this._outputBuffer;
  }

  set outputBuffer(outputBuffer) {
    this._outputBuffer = outputBuffer;
  }

  clear() {
    this._inputBuffer.clear();
    this._outputBuffer.clear();
  }
}
class RateTransposer extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this.reset();
    this._rate = 1;
  }

  set rate(rate) {
    this._rate = rate;
    // TODO: aa filter
  }

  reset() {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
  }

  clone() {
    const result = new RateTransposer();
    result.rate = this._rate;
    return result;
  }

  process() {
    // TODO: aa filter
    const numFrames = this._inputBuffer.frameCount;
    this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
    const numFramesOutput = this.transpose(numFrames);
    this._inputBuffer.receive();
    this._outputBuffer.put(numFramesOutput);
  }

  transpose(numFrames = 0) {
    if (numFrames === 0) {
      return 0;
    }

    const src = this._inputBuffer.vector;
    const srcOffset = this._inputBuffer.startIndex;

    const dest = this._outputBuffer.vector;
    const destOffset = this._outputBuffer.endIndex;

    let used = 0;
    let i = 0;

    while (this.slopeCount < 1.0) {
      dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
      dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];
      i = i + 1;
      this.slopeCount += this._rate;
    }

    this.slopeCount -= 1.0;

    if (numFrames !== 1) {
      // eslint-disable-next-line no-constant-condition
      out: while (true) {
        while (this.slopeCount > 1.0) {
          this.slopeCount -= 1.0;
          used = used + 1;
          if (used >= numFrames - 1) {
            break out;
          }
        }

        const srcIndex = srcOffset + 2 * used;
        dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
        dest[destOffset + 2 * i + 1] =
          (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];

        i = i + 1;
        this.slopeCount += this._rate;
      }
    }

    this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
    this.prevSampleR = src[srcOffset + 2 * numFrames - 1];

    return i;
  }
}
class Stretch extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this._quickSeek = true;
    this.midBufferDirty = false;

    this.midBuffer = null;
    this.overlapLength = 0;

    this.autoSeqSetting = true;
    this.autoSeekSetting = true;

    this._tempo = 1;
    this.setParameters(44100, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
  }

  clear() {
    super.clear();
    this.clearMidBuffer();
  }

  clearMidBuffer() {
    if (this.midBufferDirty) {
      this.midBufferDirty = false;
      this.midBuffer = null;
    }
  }

  /**
   * Sets routine control parameters. These control are certain time constants
   * defining how the sound is stretched to the desired duration.
   *
   * 'sampleRate' = sample rate of the sound
   * 'sequenceMS' = one processing sequence length in milliseconds (default = 82 ms)
   * 'seekwindowMS' = seeking window length for scanning the best overlapping
   *      position (default = 28 ms)
   * 'overlapMS' = overlapping length (default = 12 ms)
   */
  setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
    // accept only positive parameter values - if zero or negative, use old values instead
    if (sampleRate > 0) {
      this.sampleRate = sampleRate;
    }

    if (overlapMs > 0) {
      this.overlapMs = overlapMs;
    }

    if (sequenceMs > 0) {
      this.sequenceMs = sequenceMs;
      this.autoSeqSetting = false;
    } else {
      // zero or below, use automatic setting
      this.autoSeqSetting = true;
    }

    if (seekWindowMs > 0) {
      this.seekWindowMs = seekWindowMs;
      this.autoSeekSetting = false;
    } else {
      // zero or below, use automatic setting
      this.autoSeekSetting = true;
    }

    this.calculateSequenceParameters();

    this.calculateOverlapLength(this.overlapMs);

    // set tempo to recalculate 'sampleReq'
    this.tempo = this._tempo;
  }

  /**
   * Sets new target tempo. Normal tempo = 'SCALE', smaller values represent slower
   * tempo, larger faster tempo.
   */
  set tempo(newTempo) {
    let intskip;

    this._tempo = newTempo;

    // Calculate new sequence duration
    this.calculateSequenceParameters();

    // Calculate ideal skip length (according to tempo value)
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    intskip = Math.floor(this.nominalSkip + 0.5);

    // Calculate how many samples are needed in the 'inputBuffer' to process another batch of samples
    this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }

  get tempo() {
    return this._tempo;
  }

  get inputChunkSize() {
    return this.sampleReq;
  }

  get outputChunkSize() {
    return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength);
  }

  /**
   * Calculates overlapInMsec period length in samples.
   */
  calculateOverlapLength(overlapInMsec = 0) {
    let newOvl;

    // TODO assert(overlapInMsec >= 0);
    newOvl = (this.sampleRate * overlapInMsec) / 1000;
    newOvl = newOvl < 16 ? 16 : newOvl;

    // must be divisible by 8
    newOvl -= newOvl % 8;

    this.overlapLength = newOvl;

    this.refMidBuffer = new Float32Array(this.overlapLength * 2);
    this.midBuffer = new Float32Array(this.overlapLength * 2);
  }

  checkLimits(x, mi, ma) {
    return x < mi ? mi : x > ma ? ma : x;
  }

  /**
   * Calculates processing sequence length according to tempo setting
   */
  calculateSequenceParameters() {
    let seq;
    let seek;

    if (this.autoSeqSetting) {
      seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
      seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }

    if (this.autoSeekSetting) {
      seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
      seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }

    // Update seek window lengths
    this.seekWindowLength = Math.floor((this.sampleRate * this.sequenceMs) / 1000);
    this.seekLength = Math.floor((this.sampleRate * this.seekWindowMs) / 1000);
  }

  /**
   * Enables/disables the quick position seeking algorithm.
   */
  set quickSeek(enable) {
    this._quickSeek = enable;
  }

  clone() {
    const result = new Stretch();
    result.tempo = this._tempo;
    result.setParameters(this.sampleRate, this.sequenceMs, this.seekWindowMs, this.overlapMs);
    return result;
  }

  /**
   * Seeks for the optimal overlap-mixing position.
   */
  seekBestOverlapPosition() {
    return this._quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
  }

  /**
   * Seeks for the optimal overlap-mixing position. The 'stereo' version of the
   * routine
   *
   * The best position is determined as the position where the two overlapped
   * sample sequences are 'most alike', in terms of the highest cross-correlation
   * value over the overlapping period
   */
  seekBestOverlapPositionStereo() {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    let i = 0;

    // Slopes the amplitudes of the 'midBuffer' samples
    this.preCalculateCorrelationReferenceStereo();

    bestOffset = 0;
    bestCorrelation = Number.MIN_VALUE;

    // Scans for the best correlation value by testing each possible position over the permitted range
    for (; i < this.seekLength; i = i + 1) {
      // Calculates correlation value for the mixing position corresponding to 'i'
      correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer);

      // Checks for the highest correlation value
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = i;
      }
    }

    return bestOffset;
  }

  /**
   * Seeks for the optimal overlap-mixing position. The 'stereo' version of the
   * routine
   *
   * The best position is determined as the position where the two overlapped
   * sample sequences are 'most alike', in terms of the highest cross-correlation
   * value over the overlapping period
   */
  seekBestOverlapPositionStereoQuick() {
    let bestOffset;
    let bestCorrelation;
    let correlation;
    let scanCount = 0;
    let correlationOffset;
    let tempOffset;

    // Slopes the amplitude of the 'midBuffer' samples
    this.preCalculateCorrelationReferenceStereo();

    bestCorrelation = Number.MIN_VALUE;
    bestOffset = 0;
    correlationOffset = 0;
    tempOffset = 0;

    // Scans for the best correlation value using four-pass hierarchical search.
    //
    // The look-up table 'scans' has hierarchical position adjusting steps.
    // In first pass the routine searhes for the highest correlation with
    // relatively coarse steps, then rescans the neighbourhood of the highest
    // correlation with better resolution and so on.
    for (; scanCount < 4; scanCount = scanCount + 1) {
      let j = 0;
      while (_SCAN_OFFSETS[scanCount][j]) {
        tempOffset = correlationOffset + _SCAN_OFFSETS[scanCount][j];
        if (tempOffset >= this.seekLength) {
          break;
        }

        // Calculates correlation value for the mixing position corresponding to 'tempOffset'
        correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer);

        // Checks for the highest correlation value
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = tempOffset;
        }
        j = j + 1;
      }
      correlationOffset = bestOffset;
    }

    return bestOffset;
  }

  /**
   * Slopes the amplitude of the 'midBuffer' samples so that cross correlation
   * is faster to calculate
   */
  preCalculateCorrelationReferenceStereo() {
    let i = 0;
    let context;
    let temp;

    for (; i < this.overlapLength; i = i + 1) {
      temp = i * (this.overlapLength - i);
      context = i * 2;
      this.refMidBuffer[context] = this.midBuffer[context] * temp;
      this.refMidBuffer[context + 1] = this.midBuffer[context + 1] * temp;
    }
  }

  calculateCrossCorrelationStereo(mixingPosition, compare) {
    const mixing = this._inputBuffer.vector;
    mixingPosition += this._inputBuffer.startIndex;

    let correlation = 0;
    let i = 2;
    const calcLength = 2 * this.overlapLength;
    let mixingOffset;

    for (; i < calcLength; i = i + 2) {
      mixingOffset = i + mixingPosition;
      correlation += mixing[mixingOffset] * compare[i] + mixing[mixingOffset + 1] * compare[i + 1];
    }

    return correlation;
  }

  // TODO inline
  /**
   * Overlaps samples in 'midBuffer' with the samples in 'pInputBuffer' at position
   * of 'ovlPos'.
   */
  overlap(overlapPosition) {
    this.overlapStereo(2 * overlapPosition);
  }

  /**
   * Overlaps samples in 'midBuffer' with the samples in 'pInput'
   */
  overlapStereo(inputPosition) {
    const input = this._inputBuffer.vector;
    inputPosition += this._inputBuffer.startIndex;

    const output = this._outputBuffer.vector;
    const outputPosition = this._outputBuffer.endIndex;

    let i = 0;
    let context;
    let tempFrame;
    const frameScale = 1 / this.overlapLength;
    let fi;
    let inputOffset;
    let outputOffset;

    for (; i < this.overlapLength; i = i + 1) {
      tempFrame = (this.overlapLength - i) * frameScale;
      fi = i * frameScale;
      context = 2 * i;
      inputOffset = context + inputPosition;
      outputOffset = context + outputPosition;
      output[outputOffset + 0] = input[inputOffset + 0] * fi + this.midBuffer[context + 0] * tempFrame;
      output[outputOffset + 1] = input[inputOffset + 1] * fi + this.midBuffer[context + 1] * tempFrame;
    }
  }

  process() {
    let offset;
    let temp;
    let overlapSkip;

    if (this.midBuffer === null) {
      // if midBuffer is empty, move the first samples of the input stream into it
      if (this._inputBuffer.frameCount < this.overlapLength) {
        // wait until we've got the overlapLength samples
        return;
      }
      this.midBuffer = new Float32Array(this.overlapLength * 2);
      this._inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    }

    // Process samples as long as there are enough samples in 'inputBuffer' to form a processing frame
    // while (this._inputBuffer.frameCount >= this.sampleReq) {
      // If tempo differs from the normal ('SCALE'), scan for hte best overlapping position
      offset = this.seekBestOverlapPosition();

      /**
       * Mix the samples in the 'inputBuffer' at position of 'offset' with the samples in 'midBuffer'
       * using sliding overlapping
       * ... first partially overlap with the end of the previous sequence (that's in 'midBuffer')
       */
      this._outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      // FIXME unit?
      // overlap(uint(offset));
      this.overlap(Math.floor(offset));
      this._outputBuffer.put(this.overlapLength);

      // ... then copy sequence samples from 'inputBuffer' to output
      temp = this.seekWindowLength - 2 * this.overlapLength; // & 0xfffffffe;
      if (temp > 0) {
        this._outputBuffer.putBuffer(this._inputBuffer, offset + this.overlapLength, temp);
      }

      /**
       * Copies the end of the current sequence from 'inputBuffer' to 'midBuffer' for being mixed with
       * the beginning of the next processing sequence and so on
       */
      // assert(offset + seekWindowLength <= (int)inputBuffer.numSamples());
      const start = this._inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
      this.midBuffer.set(this._inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));

      /**
       * Remove the processed samples from the input buffer. Update the difference between
       * integer & nominal skip step to 'skipFract' in order to prevent the error from
       * accumulating over time
       */
      this.skipFract += this.nominalSkip; // real skip size
      overlapSkip = Math.floor(this.skipFract);
      this.skipFract -= overlapSkip;
      this._inputBuffer.receive(overlapSkip);
    // }
  }
}
class SoundTouch {
  constructor() {
    this.transposer = new RateTransposer(false);
    this.stretch = new Stretch(false);

    this._inputBuffer = new FifoSampleBuffer();
    this._intermediateBuffer = new FifoSampleBuffer();
    this._outputBuffer = new FifoSampleBuffer();

    this._rate = 0;
    this._tempo = 0;

    this.virtualPitch = 1.0;
    this.virtualRate = 1.0;
    this.virtualTempo = 1.0;

    this.calculateEffectiveRateAndTempo();
  }

  clear() {
    this.transposer.clear();
    this.stretch.clear();
  }

  clone() {
    const result = new SoundTouch();
    result.rate = this.rate;
    result.tempo = this.tempo;
    return result;
  }

  get rate() {
    return this._rate;
  }

  set rate(rate) {
    this.virtualRate = rate;
    this.calculateEffectiveRateAndTempo();
  }

  set rateChange(rateChange) {
    this._rate = 1.0 + 0.01 * rateChange;
  }

  get tempo() {
    return this._tempo;
  }

  set tempo(tempo) {
    this.virtualTempo = tempo;
    this.calculateEffectiveRateAndTempo();
  }

  set tempoChange(tempoChange) {
    this.tempo = 1.0 + 0.01 * tempoChange;
  }

  set pitch(pitch) {
    this.virtualPitch = pitch;
    this.calculateEffectiveRateAndTempo();
  }

  set pitchOctaves(pitchOctaves) {
    this.pitch = Math.exp(0.69314718056 * pitchOctaves);
    this.calculateEffectiveRateAndTempo();
  }

  set pitchSemitones(pitchSemitones) {
    this.pitchOctaves = pitchSemitones / 12.0;
  }

  get inputBuffer() {
    return this._inputBuffer;
  }

  get outputBuffer() {
    return this._outputBuffer;
  }

  calculateEffectiveRateAndTempo() {
    const previousTempo = this._tempo;
    const previousRate = this._rate;

    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;

    if (testFloatEqual(this._tempo, previousTempo)) {
      this.stretch.tempo = this._tempo;
    }
    if (testFloatEqual(this._rate, previousRate)) {
      this.transposer.rate = this._rate;
    }

    this.transposer.inputBuffer = this._inputBuffer;
    this.transposer.outputBuffer = this._outputBuffer;
    return;

    if (this._rate > 1.0) {
      if (this._outputBuffer != this.transposer.outputBuffer) {
        this.stretch.inputBuffer = this._inputBuffer;
        this.stretch.outputBuffer = this._intermediateBuffer;

        this.transposer.inputBuffer = this._intermediateBuffer;
        this.transposer.outputBuffer = this._outputBuffer;
      }
    } else {
      if (this._outputBuffer != this.stretch.outputBuffer) {
        this.transposer.inputBuffer = this._inputBuffer;
        this.transposer.outputBuffer = this._intermediateBuffer;

        this.stretch.inputBuffer = this._intermediateBuffer;
        this.stretch.outputBuffer = this._outputBuffer;
      }
    }
  }

  process() {
    if (this._rate > 1.0) {
      // this.stretch.process();
      this.transposer.process();
    } else {
      this.transposer.process();
      // this.stretch.process();
    }
  }
}
function extract(target, inputBuffer) {
  const position = 0;
  const numFrames = inputBuffer[0].length;
  let left = inputBuffer[0];
  let right = inputBuffer[1] || inputBuffer[0];
  let i = 0;
  for (; i < numFrames; i++) {
    target[i * 2] = left[i + position];
    target[i * 2 + 1] = right[i + position];
  }
  return Math.min(numFrames, left.length - position);
}

class WhiteNoiseProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const inputBuffer = inputs[0]; // only support one input;
    const outputBuffer = outputs[0]; // only one output;
    /*
    const st = new SoundTouch();
    st.rate = 2;
    st.pitch = 2;
    const samples = new Float32Array(128 * 2);
    extract(samples, inputBuffer);
    st.inputBuffer.putSamples(samples, 0, 128);
    st.process();
    const samples2 = new Float32Array(128 * 2);
    console.log('0000 ', st.outputBuffer, samples2);
    st.outputBuffer.extract(samples2, 0, 128);
    let i = 0;
    for (; i < 128; i++) {
      outputBuffer[0][i] = samples2[i * 2];
      outputBuffer[1][i] = samples2[i * 2 + 1];
    }
    */
    // st.clear();
    // st._inputBuffer.clear();
    // st._intermediateBuffer.clear();
    // st._outputBuffer.clear();
    /*
    outputBuffer.forEach((outputChannel, inner) => {
      let inputChannel = inputBuffer[inner] || inputBuffer[0]; // 一般只有一个 channel
      inputChannel.forEach((sample, idx) => {
        // filter to deal with input channel
        // outputChannel[idx] = filter(sample);
        outputChannel[idx] = sample;
        // 白噪声
        // outChannel[idx] = Math.random() * 2 - 1;
      });
    });
    */
    const samples = new Float32Array(128 * 2);
    const iLeft = inputBuffer[0];
    const iRight = inputBuffer[1] || inputBuffer[0];
    let i = 0;
    for (; i < 128; i++) {
      samples[2 * i] = iLeft[i];
      samples[2 * i + 1] = iRight[i];
    }
    samples.forEach((sample, idx) => {
      if (idx < 128) {
        outputBuffer[0] && (outputBuffer[0][idx] = sample);
      } else {
        outputBuffer[1] && (outputBuffer[1][idx - 128] = sample);
      }
    });
    console.log('999 ', inputBuffer, outputBuffer);
    return true;
    outputBuffer.forEach((outputChannel, inner) => {
      let inputChannel = inputBuffer[inner] || inputBuffer[0]; // 一般只有一个 channel
      let i = 0;
      for (; i < inputChannel.length; i++) {
        if (i % 2 === 0) {
          outputChannel[i] = inputChannel[i];
        } else {
          outputChannel[i] = inputChannel[i - 1];
        }
      }
      // inputChannel.forEach((sample, idx) => {
      //   // filter to deal with input channel
      //   // outputChannel[idx] = filter(sample);
      //   outputChannel[idx] = sample;
      //   // 白噪声
      //   // outChannel[idx] = Math.random() * 2 - 1;
      // });
      console.log('999 ', inputBuffer, outputBuffer);
    });
    return true;
  }
}
registerProcessor('white-noise-processor', WhiteNoiseProcessor);
