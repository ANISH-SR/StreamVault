import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../../target/types/stream_vault";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { BN } from "bn.js";
export const USDC_DECIMALS = 6;
export const ONE_USDC = new BN(10 ** USDC_DECIMALS);
export const MINIMUM_WITHDRAWAL = ONE_USDC.mul(new BN(10));
export const SprintDuration = {
  oneWeek: { oneWeek: {} },
  twoWeeks: { twoWeeks: {} },
  threeWeeks: { threeWeeks: {} },
  fourWeeks: { fourWeeks: {} },
  sixWeeks: { sixWeeks: {} },
  eightWeeks: { eightWeeks: {} },
  tenWeeks: { tenWeeks: {} },
  twelveWeeks: { twelveWeeks: {}},
};
export const AccelerationType = {
  Linear: { linear: {} },
  Quadratic: { quadratic: {} },
  Cubic: { cubic: {} },
};
export function durationToSeconds(duration: any): number {
  if (duration.oneWeek) return 7 * 24 * 60 * 60;
  if (duration.twoWeeks) return 14 * 24 * 60 * 60;
  if (duration.threeWeeks) return 21 * 24 * 60 * 60;
  if (duration.fourWeeks) return 28 * 24 * 60 * 60;
  if (duration.sixWeeks) return 42 * 24 * 60 * 60;
  if (duration.eightWeeks) return 56 * 24 * 60 * 60;
  if (duration.tenWeeks) return 70 * 24 * 60 * 60;
  if (duration.twelveWeeks) return 84 * 24 * 60 * 60;
  throw new Error("Invalid duration");
}
export function getSprintAccounts(
  program: Program<StreamVault>,
  employer: PublicKey,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const [sprint] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), sprint.toBuffer()],
    program.programId
  );
  return { sprint, vault };
}
export async function createTestContext(
  program: Program<StreamVault>,
  provider: anchor.AnchorProvider
) {
  const employer = Keypair.generate();
  const freelancer = Keypair.generate();
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(freelancer.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  const mint = await createMint(
    provider.connection,
    employer,
    employer.publicKey,
    null,
    6,
    undefined,
    { commitment: 'confirmed' }
  );
  const employerTokenAccount = await getAssociatedTokenAddress(
    mint,
    employer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const freelancerTokenAccount = await getAssociatedTokenAddress(
    mint,
    freelancer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  try {
    await provider.connection.getTokenAccountBalance(employerTokenAccount);
  } catch (e) {
    await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }
  try {
    await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
  } catch (e) {
    await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      freelancer.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }
  await mintTo(
    provider.connection,
    employer,
    mint,
    employerTokenAccount,
    employer.publicKey,
    1_000_000_000_000,
    [],
    { commitment: 'confirmed' }
  );
  return {
    employer,
    freelancer,
    mint,
    employerTokenAccount,
    freelancerTokenAccount,
  };
}
export async function createSprint(
  program: Program<StreamVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  amount: BN,
  duration: any,
  accelerationType: any,
  mint: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );
  const startTime = Math.floor(Date.now() / 1000);
  await program.methods
    .createSprint(
      sprintId,
      amount,
      duration,
      accelerationType,
      null
    )
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      freelancer,
      systemProgram: SystemProgram.programId,
    })
    .signers([employer])
    .rpc();
  return { sprint, vault, startTime };
}
export async function fundSprint(
  program: Program<StreamVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey,
  employerTokenAccount: PublicKey,
  amount?: BN
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );
  await program.methods
    .depositToEscrow(amount || null)
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      employerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
}
export async function withdrawFromSprint(
  program: Program<StreamVault>,
  employer: PublicKey,
  freelancer: Keypair,
  sprintId: BN,
  amount: BN | null,
  mint: PublicKey,
  freelancerTokenAccount: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer,
    freelancer.publicKey,
    sprintId,
    mint
  );
  await program.methods
    .withdrawStreamed(amount)
    .accounts({
      sprint,
      vault,
      freelancer: freelancer.publicKey,
      freelancerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([freelancer])
    .rpc();
}
export async function pauseSprint(
  program: Program<StreamVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const { sprint } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );
  await program.methods
    .pauseStream()
    .accounts({
      sprint,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}
export async function resumeSprint(
  program: Program<StreamVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const { sprint } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );
  await program.methods
    .resumeStream()
    .accounts({
      sprint,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}
export async function closeSprint(
  program: Program<StreamVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey,
  employerTokenAccount: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );
  await program.methods
    .closeSprint()
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      employerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
}
export function calculateAvailableAmount(
  totalAmount: BN,
  startTime: number,
  duration: any,
  currentTime: number,
  withdrawnAmount: BN,
  pauseTime: number | null,
  totalPausedDuration: BN
): BN {
  const durationSeconds = durationToSeconds(duration);
  const endTime = startTime + durationSeconds;
  if (currentTime < startTime) {
    return new BN(0);
  }
  const effectiveCurrentTime = pauseTime || currentTime;
  if (effectiveCurrentTime >= endTime) {
    return totalAmount.sub(withdrawnAmount);
  }
  const elapsedTime = effectiveCurrentTime - startTime - totalPausedDuration.toNumber();
  if (elapsedTime <= 0) {
    return new BN(0);
  }
  const availableAmount = totalAmount
    .mul(new BN(elapsedTime))
    .div(new BN(durationSeconds));
  const netAvailable = availableAmount.sub(withdrawnAmount);
  return netAvailable.isNeg() ? new BN(0) : netAvailable;
}
export async function waitForTime(seconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
export async function getCurrentTime(
  provider: anchor.AnchorProvider
): Promise<number> {
  const slot = await provider.connection.getSlot();
  const timestamp = await provider.connection.getBlockTime(slot);
  return timestamp || Math.floor(Date.now() / 1000);
}