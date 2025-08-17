import * as anchor from "@coral-xyz/anchor";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
describe("Sprint Vault Directives", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  const sprintId = new anchor.BN(Date.now());
  const totalAmount = new anchor.BN(100_000_000); 
  const minimumWithdrawal = new anchor.BN(10_000_000); 
  before(async () => {
    employer = Keypair.generate();
    freelancer = Keypair.generate();
    const airdropSig1 = await provider.connection.requestAirdrop(
      employer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig1);
    const airdropSig2 = await provider.connection.requestAirdrop(
      freelancer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);
    mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      6 
    );
    employerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey
    );
    freelancerTokenAccount = await createAssociatedTokenAccount(
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
      200_000_000 
    );
  });
  describe("Directive 1: Supported Tokens", () => {
    it("Should reject unsupported mints", async () => {
      const unsupportedMint = await createMint(
        provider.connection,
        employer,
        employer.publicKey,
        null,
        9 
      );
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          new anchor.BN(999).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 60);
      try {
        await program.methods
          .createSprint(
            new anchor.BN(999),
            startTime,
            endTime,
            totalAmount,
            null
          )
          .accounts({
            sprint: sprintPda,
            employer: employer.publicKey,
            freelancer: freelancer.publicKey,
            mint: unsupportedMint,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have rejected unsupported mint");
      } catch (error) {
        assert.include(error.toString(), "UnsupportedMint");
      }
    });
  });
  describe("Directive 2: Only Employer Can Pause/Resume", () => {
    let sprintPda: PublicKey;
    let vaultPda: PublicKey;
    before(async () => {
      const testSprintId = new anchor.BN(Date.now() + 1000);
      [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          testSprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 60);
      await program.methods
        .createSprint(
          testSprintId,
          startTime,
          endTime,
          totalAmount,
          null
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await program.methods
        .depositToEscrow(totalAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
    });
    it("Should allow employer to pause sprint", async () => {
      await program.methods
        .pauseStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.isTrue(sprint.isPaused);
    });
    it("Should reject pause from freelancer", async () => {
      await program.methods
        .resumeStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      try {
        await program.methods
          .pauseStream()
          .accounts({
            sprint: sprintPda,
            employer: freelancer.publicKey, 
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have rejected pause from non-employer");
      } catch (error) {
        assert.include(error.toString(), "ConstraintHasOne");
      }
    });
  });
  describe("Directive 3: Full Funding Required", () => {
    let sprintPda: PublicKey;
    let vaultPda: PublicKey;
    const testSprintId = new anchor.BN(Date.now() + 2000);
    before(async () => {
      [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          testSprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 60);
      await program.methods
        .createSprint(
          testSprintId,
          startTime,
          endTime,
          totalAmount,
          null
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
    });
    it("Should reject partial funding", async () => {
      const partialAmount = new anchor.BN(50_000_000); 
      try {
        await program.methods
          .depositToEscrow(partialAmount)
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employerTokenAccount: employerTokenAccount,
            employer: employer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have rejected partial funding");
      } catch (error) {
        assert.include(error.toString(), "InvalidAmount");
      }
    });
    it("Should accept full funding", async () => {
      await program.methods
        .depositToEscrow(totalAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.isTrue(sprint.isFunded);
    });
    it("Should reject additional funding after full funding", async () => {
      try {
        await program.methods
          .depositToEscrow(totalAmount)
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employerTokenAccount: employerTokenAccount,
            employer: employer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have rejected additional funding");
      } catch (error) {
        assert.include(error.toString(), "SprintAlreadyStarted");
      }
    });
    it("Should prevent withdrawal before funding", async () => {
      const unfundedSprintId = new anchor.BN(Date.now() + 3000);
      const [unfundedSprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          unfundedSprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const unfundedVaultPda = await getAssociatedTokenAddress(
        mint,
        unfundedSprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10); 
      await program.methods
        .createSprint(
          unfundedSprintId,
          startTime,
          endTime,
          totalAmount,
          null
        )
        .accounts({
          sprint: unfundedSprintPda,
          vault: unfundedVaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      try {
        await program.methods
          .withdrawStreamed().accounts({
            sprint: unfundedSprintPda,
            vault: unfundedVaultPda,
            freelancerTokenAccount: freelancerTokenAccount,
            freelancer: freelancer.publicKey,
          mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have rejected withdrawal from unfunded sprint");
      } catch (error) {
        assert.include(error.toString(), "SprintNotFunded");
      }
    });
  });
  describe("Directive 4: Minimum Withdrawal Amount", () => {
    let sprintPda: PublicKey;
    let vaultPda: PublicKey;
    const testSprintId = new anchor.BN(Date.now() + 4000);
    before(async () => {
      [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          testSprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10); 
      const smallAmount = new anchor.BN(20_000_000); 
      await program.methods
        .createSprint(
          testSprintId,
          startTime,
          endTime,
          smallAmount,
          { linear: {} } 
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const newSprintId = new anchor.BN(Date.now() + 5000);
      const [newSprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          newSprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const newVaultPda = await getAssociatedTokenAddress(
        mint,
        newSprintPda,
        true
      );
      const futureStart = new anchor.BN(currentTime + 60);
      const futureEnd = new anchor.BN(currentTime + 86460);
      await program.methods
        .createSprint(
          newSprintId,
          futureStart,
          futureEnd,
          smallAmount,
          { linear: {} }
        )
        .accounts({
          sprint: newSprintPda,
          vault: newVaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await program.methods
        .depositToEscrow(smallAmount)
        .accounts({
          sprint: newSprintPda,
          vault: newVaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      sprintPda = newSprintPda;
      vaultPda = newVaultPda;
    });
    it("Should reject withdrawal below minimum threshold", async () => {
      await new Promise(resolve => setTimeout(resolve, 61000)); 
      try {
        await program.methods
          .withdrawStreamed().accounts({
            sprint: sprintPda,
            vault: vaultPda,
            freelancerTokenAccount: freelancerTokenAccount,
            freelancer: freelancer.publicKey,
          mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have rejected withdrawal below minimum");
      } catch (error) {
        assert.include(error.toString(), "BelowMinimumWithdrawal");
      }
    });
  });
});