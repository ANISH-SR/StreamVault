import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
export const USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const SprintDuration = {
    OneWeek: 0,
    TwoWeeks: 1,
    ThreeWeeks: 2,
    FourWeeks: 3,
    SixWeeks: 4,
    EightWeeks: 5,
    TenWeeks: 6,
    TwelveWeeks: 7,
} as const;
export const AccelerationType = {
    Linear: 0,
    Quadratic: 1,
    Cubic: 2,
} as const;
export function toDurationObject(duration: number): any {
  const variants = [
    "oneWeek",
    "twoWeeks",
    "threeWeeks",
    "fourWeeks",
    "sixWeeks",
    "eightWeeks",
    "tenWeeks",
    "twelveWeeks",
  ];
  return { [variants[duration]]: {} };
}
export function toAccelerationObject(accel: number): any {
  const variants = ["linear", "quadratic", "cubic"];
  return { [variants[accel]]: {} };
}
export function calculateEndTime(startTime: number, duration: number): number {
  const durationSeconds = [
    7 * 24 * 60 * 60,      
    14 * 24 * 60 * 60,     
    21 * 24 * 60 * 60,     
    28 * 24 * 60 * 60,     
    42 * 24 * 60 * 60,     
    56 * 24 * 60 * 60,     
    70 * 24 * 60 * 60,     
    84 * 24 * 60 * 60,     
  ];
  return startTime + durationSeconds[duration];
}
export function createTestDuration(seconds: number): any {
  return { oneWeek: {} };
}
export function getDurationSeconds(duration: number): number {
  const durationSeconds = [
    7 * 24 * 60 * 60,      
    14 * 24 * 60 * 60,     
    21 * 24 * 60 * 60,     
    28 * 24 * 60 * 60,     
    42 * 24 * 60 * 60,     
    56 * 24 * 60 * 60,     
    70 * 24 * 60 * 60,     
    84 * 24 * 60 * 60,     
  ];
  return durationSeconds[duration];
}