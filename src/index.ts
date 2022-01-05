/**
 * 版本号
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
const version: string = __VERSION__;

export { version };

// source => middleware => ... => destination
import { Changer } from './changer';
import { createGain } from './middleware/gain';
import { createDistortion } from './middleware/distortion';

export { Changer, createGain, createDistortion };
