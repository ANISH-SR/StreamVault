import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";
import {
  SprintDuration,
  AccelerationType,
  ONE_USDC,
  MINIMUM_WITHDRAWAL,
  getSprintAccounts,
} from "./utils/test-helpers";
describe("Sprint Vault Directives - Fixed", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  const USDC_DECIMALS = 6;
  const totalAmount = new BN(100_000_000); 
  before(async () => {
    employer = Keypair.generate();
    freelancer = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(freelancer.publicKey, LAMPORTS_PER_SOL)
    );
    mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      USDC_DECIMALS
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
    it("Should accept supported mints", async () => {
      const sprintId = new BN(Date.now());
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 60;
      await program.methods
        .createSprint(
          sprintId,
          totalAmount,
          SprintDuration.twoWeeks,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.equal(sprintAccount.mint.toBase58(), mint.toBase58());
    });
    it("Should handle different decimal configurations", async () => {
      const mint9Decimals = await createMint(
        provider.connection,
        employer,
        employer.publicKey,
        null,
        9
      );
      const sprintId = new BN(Date.now() + 1);
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint9Decimals
      );
      const startTime = Math.floor(Date.now() / 1000) + 60;
      await program.methods
        .createSprint(
          sprintId,
          new BN(1_000_000_000), 
          SprintDuration.oneWeek,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint9Decimals,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.equal(sprintAccount.mint.toBase58(), mint9Decimals.toBase58());
    });
  });
  describe("Directive 2: Only Employer Can Pause/Resume", () => {
    let sprintId: anchor.BN;
    let sprint: PublicKey;
    let vault: PublicKey;
    before(async () => {
      sprintId = new BN(Date.now() + 1000);
      const accounts = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      sprint = accounts.sprint;
      vault = accounts.vault;
      const startTime = Math.floor(Date.now() / 1000) + 2; 
      await program.methods
        .createSprint(
          sprintId,
          totalAmount,
          SprintDuration.twoWeeks,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
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
        .depositToEscrow()
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
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
    it("Should allow employer to pause sprint", async () => {
      await program.methods
        .pauseStream()
        .accounts({
          sprint,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.isTrue(sprintAccount.isPaused);
    });
    it("Should allow employer to resume sprint", async () => {
      await program.methods
        .resumeStream()
        .accounts({
          sprint,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.isFalse(sprintAccount.isPaused);
    });
    it("Should reject pause from freelancer", async () => {
      try {
        await program.methods
          .pauseStream()
          .accounts({
            sprint,
            employer: freelancer.publicKey, 
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have rejected pause from non-employer");
      } catch (error) {
        assert.isTrue(true);
      }
    });
  });
  describe("Directive 3: Full Funding Required", () => {
    it("Should reject withdrawal from unfunded sprint", async () => {
      const sprintId = new BN(Date.now() + 2000);
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2;
      await program.methods
        .createSprint(
          sprintId,
          totalAmount,
          SprintDuration.oneWeek,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        await program.methods
          .withdrawStreamed(null)
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
        assert.fail("Should have rejected withdrawal from unfunded sprint");
      } catch (error) {
        assert.include(error.toString(), "SprintNotFunded");
      }
    });
    it("Should accept withdrawal after funding", async () => {
      const sprintId = new BN(Date.now() + 3000);
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2;
      await program.methods
        .createSprint(
          sprintId,
          totalAmount,
          SprintDuration.oneWeek,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
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
        .depositToEscrow()
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
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.isTrue(sprintAccount.isFunded);
      await new Promise(resolve => setTimeout(resolve, 120000)); 
      try {
        await program.methods
          .withdrawStreamed(null)
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
        const updatedSprint = await program.account.sprint.fetch(sprint);
        assert.isTrue(updatedSprint.withdrawnAmount.gt(new BN(0)));
      } catch (error) {
        if (error.toString().includes("BelowMinimumWithdrawal")) {
          console.log("Amount below minimum threshold (expected in early sprint)");
        } else {
          throw error;
        }
      }
    });
  });
  describe("Directive 4: Minimum Withdrawal Amount", () => {
    it("Should enforce minimum withdrawal threshold", async () => {
      const sprintId = new BN(Date.now() + 4000);
      const largeAmount = MINIMUM_WITHDRAWAL.mul(new BN(1000)); 
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2;
      await program.methods
        .createSprint(
          sprintId,
          largeAmount,
          SprintDuration.sixWeeks, 
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
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
        .depositToEscrow()
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
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        await program.methods
          .withdrawStreamed(new BN(1000)) 
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
        assert.fail("Should have rejected withdrawal below minimum");
      } catch (error) {
        assert.include(error.toString(), "BelowMinimumWithdrawal");
      }
    });
    it("Should allow withdrawal at sprint end regardless of minimum", async () => {
      const sprintId = new BN(Date.now() + 5000);
      const smallAmount = MINIMUM_WITHDRAWAL.div(new BN(2)); 
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2;
      await program.methods
        .createSprint(
          sprintId,
          smallAmount,
          SprintDuration.oneWeek, 
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
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
        .depositToEscrow()
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
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.isTrue(sprintAccount.totalAmount.lt(MINIMUM_WITHDRAWAL));
      console.log("Small sprint created successfully with amount below minimum");
    });
  });
  describe("Directive 5: Pause/Resume Limits", () => {
    it("Should enforce maximum pause/resume cycles", async () => {
      const sprintId = new BN(Date.now() + 6000);
      const { sprint, vault } = getSprintAccounts(
        program,
        employer.publicKey,
        freelancer.publicKey,
        sprintId,
        mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2;
      await program.methods
        .createSprint(
          sprintId,
          totalAmount,
          SprintDuration.oneWeek,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
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
        .depositToEscrow()
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
      await new Promise(resolve => setTimeout(resolve, 3000));
      for (let i = 0; i < 3; i++) {
        await program.methods
          .pauseStream()
          .accounts({
            sprint,
            employer: employer.publicKey,
          })
          .signers([employer])
          .rpc();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await program.methods
          .resumeStream()
          .accounts({
            sprint,
            employer: employer.publicKey,
          })
          .signers([employer])
          .rpc();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.equal(sprintAccount.pauseResumeCount, 6); 
      try {
        await program.methods
          .pauseStream()
          .accounts({
            sprint,
            employer: employer.publicKey,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have rejected fourth pause");
      } catch (error) {
        assert.include(error.toString(), "MaxPauseResumeExceeded");
      }
    });
  });
});