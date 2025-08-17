import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
} from "@solana/web3.js";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
describe("Sprint Vault Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  beforeEach(async () => {
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
      1_000_000_000 
    );
  });
  describe("Edge Case: Minimum Withdrawal Boundary", () => {
    it("Should handle sprint with total_amount exactly equal to minimum withdrawal", async () => {
      const sprintId = new anchor.BN(Date.now());
      const minAmount = new anchor.BN(10_000_000); 
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 30);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          minAmount,
          toAccelerationObject(AccelerationType.Linear)
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
        .depositToEscrow(minAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await new Promise(resolve => setTimeout(resolve, 91000));
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
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(sprint.withdrawnAmount.toString(), minAmount.toString());
    });
    it("Should reject sprint with total_amount less than minimum withdrawal", async () => {
      const sprintId = new anchor.BN(Date.now() + 1);
      const belowMinAmount = new anchor.BN(5_000_000); 
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 30);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          belowMinAmount,
          toAccelerationObject(AccelerationType.Linear)
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
        .depositToEscrow(belowMinAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await new Promise(resolve => setTimeout(resolve, 91000));
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
  describe("Edge Case: Funding Timing", () => {
    it("Should reject funding at exactly start_time", async () => {
      const sprintId = new anchor.BN(Date.now() + 2);
      const amount = new anchor.BN(100_000_000);
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 2); 
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
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
      await new Promise(resolve => setTimeout(resolve, 2100));
      try {
        await program.methods
          .depositToEscrow(amount)
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employerTokenAccount: employerTokenAccount,
            employer: employer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have rejected funding at/after start time");
      } catch (error) {
        assert.include(error.toString(), "SprintAlreadyStarted");
      }
    });
  });
  describe("Edge Case: Pause/Resume at Boundaries", () => {
    it("Should handle pause/resume near sprint end time", async () => {
      const sprintId = new anchor.BN(Date.now() + 3);
      const amount = new anchor.BN(100_000_000);
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          toAccelerationObject(AccelerationType.Linear)
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
        .depositToEscrow(amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await new Promise(resolve => setTimeout(resolve, 18000));
      await program.methods
        .pauseStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      await new Promise(resolve => setTimeout(resolve, 5000));
      await program.methods
        .resumeStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.isTrue(sprint.totalPausedDuration.toNumber() > 0);
      const newCurrentTime = Math.floor(Date.now() / 1000);
      assert.isFalse(sprint.isEnded(new anchor.BN(newCurrentTime)));
    });
  });
  describe("Edge Case: Very Short Duration Sprint", () => {
    it("Should reject sprint with zero duration", async () => {
      const sprintId = new anchor.BN(Date.now() + 4);
      const amount = new anchor.BN(100_000_000);
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      try {
        await program.methods
          .createSprint(
            sprintId,
            startTime,
            toDurationObject(SprintDuration.OneWeek),
            amount,
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
        assert.fail("Should have rejected zero duration sprint");
      } catch (error) {
        assert.include(error.toString(), "InvalidTimeRange");
      }
    });
    it("Should handle 1-second duration sprint", async () => {
      const sprintId = new anchor.BN(Date.now() + 5);
      const amount = new anchor.BN(100_000_000);
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          toAccelerationObject(AccelerationType.Linear)
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
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(
        sprint.endTime.sub(sprint.startTime).toNumber(),
        1,
        "Sprint should have 1 second duration"
      );
    });
  });
  describe("Edge Case: Overflow Scenarios", () => {
    it("Should handle maximum safe integer amounts", async () => {
      const sprintId = new anchor.BN(Date.now() + 6);
      const maxSafeAmount = new anchor.BN("9007199254740991");
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 60);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          maxSafeAmount,
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
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(sprint.totalAmount.toString(), maxSafeAmount.toString());
    });
  });
  describe("Edge Case: Closing Unfunded Sprint", () => {
    it("Should allow closing unfunded sprint after end time", async () => {
      const sprintId = new anchor.BN(Date.now() + 7);
      const amount = new anchor.BN(100_000_000);
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 2);
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
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
      await new Promise(resolve => setTimeout(resolve, 5000));
      await program.methods
        .closeSprint()
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      try {
        await program.account.sprint.fetch(sprintPda);
        assert.fail("Sprint account should be closed");
      } catch (error) {
        assert.include(error.toString(), "Account does not exist");
      }
    });
  });
});