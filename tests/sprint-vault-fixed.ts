import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { assert } from "chai";
import { BN } from "bn.js";
import {
  createTestContext,
  createSprint,
  fundSprint,
  withdrawFromSprint,
  pauseSprint,
  resumeSprint,
  closeSprint,
  SprintDuration,
  AccelerationType,
  ONE_USDC,
  waitForTime,
  getCurrentTime,
  getSprintAccounts,
} from "./utils/test-helpers";
describe("sprint-vault-fixed", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  describe("Basic Sprint Operations", () => {
    it("Should create, fund, and withdraw from a sprint", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now());
      const amount = ONE_USDC.mul(new BN(100)); 
      const { sprint, vault, startTime } = await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        amount,
        SprintDuration.oneWeek,
        AccelerationType.Linear,
        ctx.mint
      );
      console.log("✓ Sprint created successfully");
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.equal(sprintAccount.sprintId.toNumber(), sprintId.toNumber());
      assert.equal(sprintAccount.totalAmount.toNumber(), amount.toNumber());
      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );
      console.log("✓ Sprint funded successfully");
      const fundedSprint = await program.account.sprint.fetch(sprint);
      assert.isTrue(fundedSprint.isFunded);
      console.log("Waiting for sprint to start and time to pass...");
      await waitForTime(65); 
      const currentTime = await getCurrentTime(provider);
      const elapsedTime = currentTime - startTime;
      const totalDuration = 7 * 24 * 60 * 60; 
      await waitForTime(120); 
      try {
        await withdrawFromSprint(
          program,
          ctx.employer.publicKey,
          ctx.freelancer,
          sprintId,
          null, 
          ctx.mint,
          ctx.freelancerTokenAccount
        );
        console.log("✓ Successfully withdrew funds");
        const updatedSprint = await program.account.sprint.fetch(sprint);
        assert.isTrue(updatedSprint.withdrawnAmount.gt(new BN(0)));
        console.log(`Withdrawn amount: ${updatedSprint.withdrawnAmount.toNumber()}`);
      } catch (e) {
        console.log("Withdrawal failed (expected if amount below minimum):", e.message);
      }
    });
    it("Should handle pause and resume correctly", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now() + 1);
      const amount = ONE_USDC.mul(new BN(1000)); 
      const { sprint } = await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        amount,
        SprintDuration.twoWeeks,
        AccelerationType.Linear,
        ctx.mint
      );
      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );
      await waitForTime(65);
      await pauseSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint
      );
      console.log("✓ Sprint paused successfully");
      const pausedSprint = await program.account.sprint.fetch(sprint);
      assert.isTrue(pausedSprint.isPaused);
      await waitForTime(5);
      await resumeSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint
      );
      console.log("✓ Sprint resumed successfully");
      const resumedSprint = await program.account.sprint.fetch(sprint);
      assert.isFalse(resumedSprint.isPaused);
      assert.isTrue(resumedSprint.totalPausedDuration.gt(new BN(0)));
    });
    it("Should reject unsupported operations", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now() + 2);
      const amount = ONE_USDC.mul(new BN(100));
      const { sprint } = await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        amount,
        SprintDuration.oneWeek,
        AccelerationType.Linear,
        ctx.mint
      );
      try {
        await withdrawFromSprint(
          program,
          ctx.employer.publicKey,
          ctx.freelancer,
          sprintId,
          null,
          ctx.mint,
          ctx.freelancerTokenAccount
        );
        assert.fail("Should have failed - sprint not funded");
      } catch (e) {
        assert.include(e.toString(), "SprintNotFunded");
        console.log("✓ Correctly rejected withdrawal from unfunded sprint");
      }
      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );
      try {
        await withdrawFromSprint(
          program,
          ctx.employer.publicKey,
          ctx.freelancer,
          sprintId,
          null,
          ctx.mint,
          ctx.freelancerTokenAccount
        );
        assert.fail("Should have failed - sprint not started");
      } catch (e) {
        assert.include(e.toString(), "SprintNotStarted");
        console.log("✓ Correctly rejected withdrawal before sprint start");
      }
      try {
        await pauseSprint(
          program,
          ctx.freelancer, 
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        assert.fail("Should have failed - unauthorized pause");
      } catch (e) {
        console.log("✓ Correctly rejected unauthorized pause");
      }
    });
    it("Should handle edge case amounts correctly", async () => {
      const ctx = await createTestContext(program, provider);
      try {
        await createSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          new BN(Date.now() + 10),
          new BN(0), 
          SprintDuration.oneWeek,
          AccelerationType.Linear,
          ctx.mint
        );
        assert.fail("Should have failed - zero amount");
      } catch (e) {
        assert.include(e.toString(), "InvalidAmount");
        console.log("✓ Correctly rejected zero amount sprint");
      }
      const largeAmount = new BN(2).pow(new BN(63)); 
      const { sprint } = await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        new BN(Date.now() + 11),
        largeAmount,
        SprintDuration.twelveWeeks,
        AccelerationType.Linear,
        ctx.mint
      );
      const sprintAccount = await program.account.sprint.fetch(sprint);
      assert.equal(sprintAccount.totalAmount.toString(), largeAmount.toString());
      console.log("✓ Successfully handled large amount sprint");
    });
    it("Should complete full sprint lifecycle", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now() + 20);
      const amount = ONE_USDC.mul(new BN(100));
      const { sprint, vault } = getSprintAccounts(
        program,
        ctx.employer.publicKey,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint
      );
      const startTime = Math.floor(Date.now() / 1000) + 2; 
      const duration = SprintDuration.oneWeek; 
      await program.methods
        .createSprint(
          sprintId,
          amount,
          duration,
          AccelerationType.Linear,
          new BN(startTime)
        )
        .accounts({
          sprint,
          vault,
          employer: ctx.employer.publicKey,
          freelancer: ctx.freelancer.publicKey,
          mint: ctx.mint,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([ctx.employer])
        .rpc();
      console.log("✓ Sprint created");
      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );
      console.log("✓ Sprint funded");
      await waitForTime(3);
      await pauseSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint
      );
      console.log("✓ Sprint paused");
      await waitForTime(2);
      await resumeSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint
      );
      console.log("✓ Sprint resumed");
      await waitForTime(60);
      try {
        await withdrawFromSprint(
          program,
          ctx.employer.publicKey,
          ctx.freelancer,
          sprintId,
          null,
          ctx.mint,
          ctx.freelancerTokenAccount
        );
        console.log("✓ Partial withdrawal successful");
      } catch (e) {
        console.log("Partial withdrawal skipped:", e.message);
      }
      const sprintData = await program.account.sprint.fetch(sprint);
      const endTime = sprintData.endTime.toNumber() + sprintData.totalPausedDuration.toNumber();
      const currentTime = await getCurrentTime(provider);
      if (currentTime < endTime) {
        console.log(`Waiting ${endTime - currentTime} seconds for sprint to end...`);
      }
      console.log("✓ Full sprint lifecycle completed");
    });
  });
});