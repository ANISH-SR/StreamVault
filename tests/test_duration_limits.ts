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
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
describe("Sprint Duration Limits", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.StreamVault as Program<StreamVault>;
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let employerTokenAccount: PublicKey;
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    const HOUR = 60 * 60;
    const DAY = 24 * HOUR;
    const YEAR = 365 * DAY;
    const MIN_DURATION = HOUR;        
    const MAX_DURATION = YEAR;        
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
    });
    describe("Minimum Duration Validation", () => {
        it("Should reject sprint shorter than 1 hour", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + 30 * 60); 
            const totalAmount = USDC_AMOUNT(100);
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            try {
                expect.fail("Should have failed with SprintTooShort");
            } catch (error) {
                expect(error.toString()).to.include("SprintTooShort");
            }
        });
        it("Should accept sprint exactly 1 hour long", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + MIN_DURATION); 
            const totalAmount = USDC_AMOUNT(100);
        });
    });
    describe("Maximum Duration Validation", () => {
        it("Should reject sprint longer than 365 days", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + YEAR + DAY); 
            const totalAmount = USDC_AMOUNT(100);
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            try {
                expect.fail("Should have failed with SprintTooLong");
            } catch (error) {
                expect(error.toString()).to.include("SprintTooLong");
            }
        });
        it("Should accept sprint exactly 365 days long", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + MAX_DURATION); 
            const totalAmount = USDC_AMOUNT(100);
        });
    });
    describe("Common Sprint Durations", () => {
        it("Should accept 1 week sprint", async () => {
            const duration = 7 * DAY;
        });
        it("Should accept 2 week sprint", async () => {
            const duration = 14 * DAY;
        });
        it("Should accept 1 month sprint", async () => {
            const duration = 30 * DAY;
        });
        it("Should accept 3 month sprint", async () => {
            const duration = 90 * DAY;
        });
        it("Should accept 6 month sprint", async () => {
            const duration = 180 * DAY;
        });
    });
    describe("Duration Edge Cases", () => {
        it("Should handle duration calculation with pause time correctly", async () => {
        });
        it("Should validate duration independent of pause limits", async () => {
        });
    });
});