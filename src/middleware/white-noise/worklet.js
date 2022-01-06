class WhiteNoiseProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    outputs.forEach((output, outer) => {
      const input = inputs[outer];
      output.forEach((outChannel, inner) => {
        const inChannel = input[inner];
        inChannel.forEach((sample, idx) => {
          outChannel[idx] = sample;
          // 白噪声
          // outChannel[idx] = Math.random() * 2 - 1;
        });
      });
    });
    return true;
  }
}
registerProcessor('white-noise-processor', WhiteNoiseProcessor);
