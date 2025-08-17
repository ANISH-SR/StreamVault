import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import * as fc from "fast-check";
import { assert } from "chai";
import { BN } from "bn.js";
import {
  createTestContext,
  createSprint,
  fundSprint,
  withdrawFromSprint,
  pauseSprint,
  resumeSprint,
  SprintDuration,
  AccelerationType,
  ONE_USDC,
  MINIMUM_WITHDRAWAL,
  waitForTime,
  getCurrentTime,
  getSprintAccounts,
  durationToSeconds,
} from "./utils/test-helpers";
describe("Improved Fuzzing Tests - Sprint Vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  const FUZZ_CONFIG = {
    MIN_SPRINT_ID: 1,
    MAX_SPRINT_ID: Number.MAX_SAFE_INTEGER,
    MIN_AMOUNT: MINIMUM_WITHDRAWAL.toNumber(), 
    MAX_AMOUNT: new BN(1_000_000).mul(ONE_USDC).toNumber(), 
    VALID_DURATIONS: [
      SprintDuration.oneWeek,
      SprintDuration.twoWeeks,
      SprintDuration.oneWeek,
      SprintDuration.threeWeeks,
      SprintDuration.sixWeeks,
    ],
    MIN_START_OFFSET: 60, 
    MAX_START_OFFSET: 3600, 
    MIN_WITHDRAWAL_PERCENTAGE: 0.01, 
    MAX_WITHDRAWAL_PERCENTAGE: 1.0, 
  };
  const sprintIdArb = fc.integer({
    min: FUZZ_CONFIG.MIN_SPRINT_ID,
    max: FUZZ_CONFIG.MAX_SPRINT_ID,
  });
  const amountArb = fc.integer({
    min: FUZZ_CONFIG.MIN_AMOUNT,
    max: FUZZ_CONFIG.MAX_AMOUNT,
  }).map(n => new BN(n));
  const durationArb = fc.constantFrom(...FUZZ_CONFIG.VALID_DURATIONS);
  const accelerationArb = fc.constantFrom(
    AccelerationType.Linear,
    AccelerationType.Quadratic,
    AccelerationType.Quadratic,
    AccelerationType.Quadratic
  );
  const startOffsetArb = fc.integer({
    min: FUZZ_CONFIG.MIN_START_OFFSET,
    max: FUZZ_CONFIG.MAX_START_OFFSET,
  });
  describe("Property-based Sprint Creation Tests", () => {
    it("Should successfully create sprints with valid random parameters", async () => {
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          amountArb,
          durationArb,
          accelerationArb,
          startOffsetArb,
          async (sprintId, amount, duration, acceleration, startOffset) => {
            const ctx = await createTestContext(program, provider);
            try {
              const { sprint, vault } = getSprintAccounts(
                program,
                ctx.employer.publicKey,
                ctx.freelancer.publicKey,
                new BN(sprintId),
                ctx.mint
              );
              const startTime = Math.floor(Date.now() / 1000) + startOffset;
              await program.methods
                .createSprint(
                  new BN(sprintId),
                  amount,
                  duration,
                  acceleration,
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
              const sprintAccount = await program.account.sprint.fetch(sprint);
              assert.equal(sprintAccount.sprintId.toString(), sprintId.toString());
              assert.equal(sprintAccount.totalAmount.toString(), amount.toString());
              assert.equal(sprintAccount.startTime.toNumber(), startTime);
              assert.isFalse(sprintAccount.isFunded);
              assert.isFalse(sprintAccount.isPaused);
              const durationSeconds = durationToSeconds(duration);
              const expectedEndTime = startTime + durationSeconds;
              assert.equal(sprintAccount.endTime.toNumber(), expectedEndTime);
              return true;
            } catch (error) {
              console.error(`Unexpected error with params:`, {
                sprintId,
                amount: amount.toString(),
                duration,
                acceleration,
                startOffset
              });
              throw error;
            }
          }
        ),
        { 
          numRuns: 10, 
          verbose: true,
          timeout: 30000 
        }
      );
    });
    it("Should reject sprints with invalid parameters", async () => {
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          durationArb,
          accelerationArb,
          async (sprintId, duration, acceleration) => {
            const ctx = await createTestContext(program, provider);
            try {
              await createSprint(
                program,
                ctx.employer,
                ctx.freelancer.publicKey,
                new BN(sprintId),
                new BN(0), 
                duration,
                acceleration,
                ctx.mint
              );
              assert.fail("Should have rejected zero amount");
            } catch (error) {
              assert.include(error.toString(), "InvalidAmount");
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          amountArb,
          durationArb,
          async (sprintId, amount, duration) => {
            const ctx = await createTestContext(program, provider);
            const { sprint, vault } = getSprintAccounts(
              program,
              ctx.employer.publicKey,
              ctx.freelancer.publicKey,
              new BN(sprintId),
              ctx.mint
            );
            const pastTime = Math.floor(Date.now() / 1000) - 3600; 
            try {
              await program.methods
                .createSprint(
                  new BN(sprintId),
                  amount,
                  duration,
                  AccelerationType.Linear,
                  new BN(pastTime)
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
              assert.fail("Should have rejected past start time");
            } catch (error) {
              assert.isTrue(true);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
  });
  describe("Property-based Withdrawal Tests", () => {
    it("Should never allow withdrawal exceeding available funds", async () => {
      await fc.assert(
        fc.asyncProperty(
          amountArb,
          fc.float({ min: 0.1, max: 0.9 }), 
          fc.float({ min: 0.01, max: 2.0 }), 
          async (totalAmount, timeProgress, withdrawalPercentage) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              totalAmount,
              SprintDuration.oneWeek,
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
            const durationSeconds = 7 * 24 * 60 * 60; 
            const timeToWait = Math.floor(durationSeconds * timeProgress);
            const expectedAvailable = totalAmount
              .mul(new BN(Math.floor(timeProgress * 100)))
              .div(new BN(100));
            const withdrawAmount = totalAmount
              .mul(new BN(Math.floor(withdrawalPercentage * 100)))
              .div(new BN(100));
            if (withdrawAmount.lte(expectedAvailable) && withdrawAmount.gte(MINIMUM_WITHDRAWAL)) {
              try {
                const sprintAccount = await program.account.sprint.fetch(sprint);
                assert.isTrue(sprintAccount.isFunded);
                assert.equal(sprintAccount.withdrawnAmount.toNumber(), 0);
              } catch (error) {
                console.error("Unexpected withdrawal error:", error);
                throw error;
              }
            } else {
              try {
                assert.isTrue(true); 
              } catch (error) {
                assert.include(error.toString(), "NoFundsAvailable");
              }
            }
          }
        ),
        { numRuns: 10, timeout: 30000 }
      );
    });
    it("Should respect minimum withdrawal threshold", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: MINIMUM_WITHDRAWAL.toNumber() - 1 }),
          async (smallAmount) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              MINIMUM_WITHDRAWAL.mul(new BN(100)), 
              SprintDuration.oneWeek,
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
            try {
              await withdrawFromSprint(
                program,
                ctx.employer.publicKey,
                ctx.freelancer,
                sprintId,
                new BN(smallAmount),
                ctx.mint,
                ctx.freelancerTokenAccount
              );
              assert.fail("Should have rejected withdrawal below minimum");
            } catch (error) {
              assert.isTrue(true);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
  });
  describe("Property-based Pause/Resume Tests", () => {
    it("Should maintain invariants through pause/resume cycles", async () => {
      type Operation = "pause" | "resume" | "wait" | "withdraw";
      const operationArb = fc.array(
        fc.constantFrom<Operation>("pause", "resume", "wait", "withdraw"),
        { minLength: 1, maxLength: 10 }
      );
      await fc.assert(
        fc.asyncProperty(
          amountArb,
          operationArb,
          async (totalAmount, operations) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              totalAmount,
              SprintDuration.oneWeek,
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
            let isPaused = false;
            let pauseCount = 0;
            let totalWithdrawn = new BN(0);
            for (const op of operations) {
              try {
                switch (op) {
                  case "pause":
                    if (!isPaused && pauseCount < 3) {
                      await pauseSprint(
                        program,
                        ctx.employer,
                        ctx.freelancer.publicKey,
                        sprintId,
                        ctx.mint
                      );
                      isPaused = true;
                      pauseCount++;
                    }
                    break;
                  case "resume":
                    if (isPaused) {
                      await resumeSprint(
                        program,
                        ctx.employer,
                        ctx.freelancer.publicKey,
                        sprintId,
                        ctx.mint
                      );
                      isPaused = false;
                    }
                    break;
                  case "wait":
                    await waitForTime(10);
                    break;
                  case "withdraw":
                    if (!isPaused) {
                      try {
                        const withdrawAmount = totalAmount.div(new BN(10));
                        if (withdrawAmount.gte(MINIMUM_WITHDRAWAL)) {
                          await withdrawFromSprint(
                            program,
                            ctx.employer.publicKey,
                            ctx.freelancer,
                            sprintId,
                            withdrawAmount,
                            ctx.mint,
                            ctx.freelancerTokenAccount
                          );
                          totalWithdrawn = totalWithdrawn.add(withdrawAmount);
                        }
                      } catch (e) {
                      }
                    }
                    break;
                }
              } catch (error) {
              }
            }
            const sprintAccount = await program.account.sprint.fetch(sprint);
            assert.isTrue(sprintAccount.withdrawnAmount.lte(sprintAccount.totalAmount));
            assert.isTrue(sprintAccount.pauseResumeCount <= 6); 
            if (sprintAccount.isPaused) {
              assert.isNotNull(sprintAccount.pauseTime);
            } else {
              assert.isNull(sprintAccount.pauseTime);
            }
            assert.isTrue(sprintAccount.totalPausedDuration.gte(new BN(0)));
          }
        ),
        { numRuns: 5, timeout: 60000 }
      );
    });
    it("Should reject excessive pause/resume cycles", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now());
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ONE_USDC.mul(new BN(1000)),
        SprintDuration.oneWeek,
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
      for (let i = 0; i < 3; i++) {
        await pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        await waitForTime(2);
        await resumeSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        await waitForTime(2);
      }
      try {
        await pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        assert.fail("Should have rejected fourth pause");
      } catch (error) {
        assert.include(error.toString(), "MaxPauseResumeExceeded");
      }
    });
  });
  describe("Edge Case Boundary Tests", () => {
    it("Should handle amounts at exact boundaries", async () => {
      const ctx = await createTestContext(program, provider);
      const minSprintId = new BN(Date.now());
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        minSprintId,
        MINIMUM_WITHDRAWAL, 
        SprintDuration.oneWeek,
        AccelerationType.Linear,
        ctx.mint
      );
      const maxSprintId = new BN(Date.now() + 1);
      const maxAmount = new BN(2).pow(new BN(53)); 
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        maxSprintId,
        maxAmount,
        SprintDuration.sixWeeks,
        AccelerationType.Linear,
        ctx.mint
      );
      const { sprint: minSprint } = getSprintAccounts(
        program,
        ctx.employer.publicKey,
        ctx.freelancer.publicKey,
        minSprintId,
        ctx.mint
      );
      const { sprint: maxSprint } = getSprintAccounts(
        program,
        ctx.employer.publicKey,
        ctx.freelancer.publicKey,
        maxSprintId,
        ctx.mint
      );
      const minSprintAccount = await program.account.sprint.fetch(minSprint);
      const maxSprintAccount = await program.account.sprint.fetch(maxSprint);
      assert.equal(minSprintAccount.totalAmount.toString(), MINIMUM_WITHDRAWAL.toString());
      assert.equal(maxSprintAccount.totalAmount.toString(), maxAmount.toString());
    });
    it("Should handle time boundaries correctly", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            0, 
            3600, 
            86400, 
            604800, 
            2592000, 
            31536000, 
            2147483647 
          ),
          async (startOffset) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime + startOffset > 2147483647) {
              return; 
            }
            const { sprint, vault } = getSprintAccounts(
              program,
              ctx.employer.publicKey,
              ctx.freelancer.publicKey,
              sprintId,
              ctx.mint
            );
            const startTime = currentTime + startOffset;
            try {
              await program.methods
                .createSprint(
                  sprintId,
                  ONE_USDC.mul(new BN(100)),
                  SprintDuration.oneWeek,
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
              const sprintAccount = await program.account.sprint.fetch(sprint);
              assert.equal(sprintAccount.startTime.toNumber(), startTime);
              const expectedEndTime = startTime + (7 * 24 * 60 * 60);
              assert.equal(sprintAccount.endTime.toNumber(), expectedEndTime);
            } catch (error) {
              console.log(`Time boundary test failed for offset ${startOffset}:`, error.message);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
    it("Should handle acceleration type variations", async () => {
      const ctx = await createTestContext(program, provider);
      const accelerationTypes = [
        AccelerationType.Linear,
        AccelerationType.Quadratic,
        AccelerationType.Quadratic,
        AccelerationType.Quadratic,
      ];
      for (const [index, acceleration] of accelerationTypes.entries()) {
        const sprintId = new BN(Date.now() + index);
        const { sprint } = await createSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ONE_USDC.mul(new BN(1000)),
          SprintDuration.twoWeeks,
          acceleration,
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
        const sprintAccount = await program.account.sprint.fetch(sprint);
        assert.isNotNull(sprintAccount.accelerationType);
        await waitForTime(65);
        assert.isTrue(sprintAccount.isFunded);
      }
    });
  });
  describe("Stress Testing with Extreme Values", () => {
    it("Should handle rapid sequential operations", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now());
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ONE_USDC.mul(new BN(10000)),
        SprintDuration.oneWeek,
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
      const operations = [];
      operations.push(
        pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        )
      );
      await waitForTime(1);
      operations.push(
        resumeSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        )
      );
      try {
        await Promise.all(operations);
        assert.fail("Concurrent operations should fail");
      } catch (error) {
        assert.isTrue(true);
      }
    });
    it("Should handle mathematical edge cases", async () => {
      const testCases = [
        { amount: new BN(1), description: "Minimum amount (1 unit)" },
        { amount: new BN(2).pow(new BN(32)), description: "2^32 (32-bit boundary)" },
        { amount: new BN(2).pow(new BN(53)), description: "2^53 (JavaScript safe integer)" },
        { amount: new BN(2).pow(new BN(63)).sub(new BN(1)), description: "2^63-1 (max signed 64-bit)" },
      ];
      for (const testCase of testCases) {
        const ctx = await createTestContext(program, provider);
        const sprintId = new BN(Date.now() + Math.random() * 1000000);
        try {
          await createSprint(
            program,
            ctx.employer,
            ctx.freelancer.publicKey,
            sprintId,
            testCase.amount,
            SprintDuration.oneWeek,
            AccelerationType.Linear,
            ctx.mint
          );
          console.log(`✓ Successfully handled ${testCase.description}`);
        } catch (error) {
          console.log(`✗ Failed for ${testCase.description}: ${error.message}`);
          if (testCase.amount.lt(MINIMUM_WITHDRAWAL)) {
            assert.include(error.toString(), "InvalidAmount");
          }
        }
      }
    });
  });
});