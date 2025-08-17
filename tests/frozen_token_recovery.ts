import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { 
    Keypair, 
    SystemProgram, 
    PublicKey,
    LAMPORTS_PER_SOL,
    Transaction,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    freezeAccount,
    thawAccount,
    closeAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { 
    setupTest, 
    SUPPORTED_MINTS,
    createTestMint,
    fundAccount 
} from "./test-helpers";
describe("Frozen Token Account Recovery Tests", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.StreamVault as Program<StreamVault>;
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let mintAuthority: Keypair;
    let freezeAuthority: Keypair;
    let employerTokenAccount: PublicKey;
    let freelancerTokenAccount: PublicKey;
    let sprintPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        mintAuthority = Keypair.generate();
        freezeAuthority = Keypair.generate();
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freelancer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freezeAuthority.publicKey, 2 * LAMPORTS_PER_SOL)
        );
        mint = await createMint(
            provider.connection,
            employer,
            mintAuthority.publicKey,
            freezeAuthority.publicKey, 
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
            mintAuthority,
            mint,
            employerTokenAccount,
            mintAuthority,
            1000 * Math.pow(10, DECIMALS)
        );
    });
    describe("Frozen Account Detection", () => {
        it("Should reject withdrawal to a frozen freelancer account", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100); 
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} } 
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            const accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.true;
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
        it("Should allow withdrawal after account is thawed", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100); 
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            let accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.true;
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.false;
            const balanceBefore = accountInfo.amount;
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            const accountAfter = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(accountAfter.amount)).to.be.greaterThan(Number(balanceBefore));
        });
        it("Should detect frozen vault account and prevent deposits", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 100); 
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                vaultTokenAccount,
                mint,
                freezeAuthority
            );
            try {
                await program.methods
                    .depositToEscrow(totalAmount)
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        employerTokenAccount: employerTokenAccount,
                        employer: employer.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
    });
    describe("Recovery Scenarios", () => {
        it("Should preserve funds in vault when freelancer account is frozen", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100);
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            const vaultBefore = await getAccount(provider.connection, vaultTokenAccount);
            expect(Number(vaultBefore.amount)).to.equal(100 * Math.pow(10, DECIMALS));
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
            } catch (error) {
            }
            const vaultAfter = await getAccount(provider.connection, vaultTokenAccount);
            expect(Number(vaultAfter.amount)).to.equal(Number(vaultBefore.amount));
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            const freelancerAccount = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(freelancerAccount.amount)).to.be.greaterThan(0);
        });
        it("Should handle multiple freeze/thaw cycles correctly", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100);
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            let totalWithdrawn = 0;
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            let account = await getAccount(provider.connection, freelancerTokenAccount);
            totalWithdrawn = Number(account.amount);
            expect(totalWithdrawn).to.be.greaterThan(0);
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            await new Promise(resolve => setTimeout(resolve, 2000));
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            account = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(account.amount)).to.be.greaterThan(totalWithdrawn);
        });
    });
    describe("Edge Cases", () => {
        it("Should handle frozen employer account correctly during deposit", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 100);
            const totalAmount = USDC_AMOUNT(100);
            const duration = { oneWeek: {} };
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                employerTokenAccount,
                mint,
                freezeAuthority
            );
            try {
                await program.methods
                    .depositToEscrow(totalAmount)
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        employerTokenAccount: employerTokenAccount,
                        employer: employer.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
    });
});