import * as anchor from "@coral-xyz/anchor";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import { Program, BN } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { 
    Keypair, 
    SystemProgram, 
    PublicKey,
    LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
describe("Sprint Vault - New Directives Tests", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.StreamVault as Program<StreamVault>;
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let employerTokenAccount: PublicKey;
    let freelancerTokenAccount: PublicKey;
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    const MIN_WITHDRAWAL = USDC_AMOUNT(10); 
    const MAX_PAUSE_RESUME_COUNT = 3;
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freelancer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        mint = await createMint(
            provider.connection,
            employer,
            employer.publicKey,
            null,
            DECIMALS
        );
        employerTokenAccount = await createAccount(
            provider.connection,
            employer,
            mint,
            employer.publicKey
        );
        freelancerTokenAccount = await createAccount(
            provider.connection,
            freelancer,
            mint,
            freelancer.publicKey
        );
        await mintTo(
            provider.connection,
            employer,
            mint,
            employerTokenAccount,
            employer,
            1000 * Math.pow(10, DECIMALS)
        );
    });
    describe("Pause/Resume Limit Tests", () => {
        it("Should allow up to 3 pause/resume cycles", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 5);
            const endTime = new BN(currentTime + 100);
            const totalAmount = USDC_AMOUNT(100);
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 6000));
            for (let i = 0; i < MAX_PAUSE_RESUME_COUNT; i++) {
                await program.methods
                    .pauseStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                await new Promise(resolve => setTimeout(resolve, 1000));
                await program.methods
                    .resumeStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            try {
                await program.methods
                    .pauseStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have failed with MaxPauseResumeExceeded");
            } catch (error) {
                expect(error.toString()).to.include("MaxPauseResumeExceeded");
            }
        });
    });
    describe("Auto-Close Tests", () => {
        it("Should auto-close sprint if pause duration exceeds sprint duration", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 10); 
            const totalAmount = USDC_AMOUNT(100);
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 3000));
            await program.methods
                .pauseStream()
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 9000));
            try {
                await program.methods
                    .resumeStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have failed with SprintAutoClosedDueToExcessivePause");
            } catch (error) {
                expect(error.toString()).to.include("SprintAutoClosedDueToExcessivePause");
            }
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
        });
    });
    describe("Minimum Withdrawal Special Cases", () => {
        it("Should allow withdrawal of small sprint total at the end", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 5);
            const totalAmount = USDC_AMOUNT(5); 
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 3500));
            try {
                await program.methods
                    .withdrawStreamed().accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
          mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have failed - small sprint can only withdraw at end");
            } catch (error) {
                expect(error.toString()).to.include("BelowMinimumWithdrawal");
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            const freelancerAccount = await getAccount(
                provider.connection,
                freelancerTokenAccount
            );
            expect(Number(freelancerAccount.amount)).to.equal(totalAmount.toNumber());
        });
        it("Should allow final withdrawal regardless of minimum", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 10);
            const totalAmount = USDC_AMOUNT(15); 
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 7000));
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 4000));
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            const freelancerAccount = await getAccount(
                provider.connection,
                freelancerTokenAccount
            );
            expect(Number(freelancerAccount.amount)).to.equal(totalAmount.toNumber());
        });
    });
    describe("Edge Case: Pause at Sprint End", () => {
        it("Should handle pause attempt exactly at sprint end time", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 5);
            const totalAmount = USDC_AMOUNT(100);
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await new Promise(resolve => setTimeout(resolve, 3000));
            await program.methods
                .pauseStream()
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
        });
    });
});