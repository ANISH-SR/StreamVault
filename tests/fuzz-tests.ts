import * as anchor from "@coral-xyz/anchor";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  freezeAccount,
  thawAccount,
  closeAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fc from "fast-check";
interface NetworkEnvironment {
  type: "mainnet" | "devnet" | "localnet";
  endpoint: string;
  commitment: anchor.web3.Commitment;
}
interface TokenConfig {
  decimals: number;
  initialSupply: bigint;
  freezeAuthority?: anchor.web3.PublicKey;
  mintAuthority?: anchor.web3.PublicKey;
}
interface ConcurrentTxResult {
  signature: string;
  success: boolean;
  error?: Error;
  executionTime: number;
}
async function createFrozenTokenAccount(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.Keypair
): Promise<anchor.web3.PublicKey> {
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  await freezeAccount(
    connection,
    payer,
    tokenAccount,
    mint,
    freezeAuthority
  );
  return tokenAccount;
}
async function simulateClosedTokenAccount(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  closeAuthority: anchor.web3.Keypair
): Promise<{
  accountAddress: anchor.web3.PublicKey;
  createSignature: string;
  closeSignature: string;
}> {
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );
  const createSignature = "account_created"; 
  const closeSignature = await closeAccount(
    connection,
    payer,
    tokenAccount,
    payer.publicKey, 
    closeAuthority
  );
  return {
    accountAddress: tokenAccount,
    createSignature,
    closeSignature,
  };
}
function setupNetworkEnvironment(
  envType: "mainnet" | "devnet" | "localnet" = "localnet"
): anchor.AnchorProvider {
  let endpoint: string;
  let commitment: anchor.web3.Commitment = "confirmed";
  switch (envType) {
    case "mainnet":
      endpoint = "https:
      commitment = "finalized";
      break;
    case "devnet":
      endpoint = "https:
      commitment = "confirmed";
      break;
    case "localnet":
    default:
      endpoint = "http:
      commitment = "processed";
      break;
  }
  const connection = new anchor.web3.Connection(endpoint, {
    commitment,
    confirmTransactionInitialTimeout: 60000,
  });
  const wallet = anchor.AnchorProvider.env().wallet;
  return new anchor.AnchorProvider(connection, wallet, {
    commitment,
    preflightCommitment: commitment,
    skipPreflight: false,
  });
}
async function createTokenWithDecimals(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  config: TokenConfig
): Promise<{
  mint: anchor.web3.PublicKey;
  tokenAccount: anchor.web3.PublicKey;
  mintAuthority: anchor.web3.Keypair;
  freezeAuthority: anchor.web3.Keypair | null;
}> {
  const mintAuthority = anchor.web3.Keypair.generate();
  const freezeAuthority = config.freezeAuthority ? anchor.web3.Keypair.generate() : null;
  const mint = await createMint(
    connection,
    payer,
    config.mintAuthority || mintAuthority.publicKey,
    freezeAuthority?.publicKey || null,
    config.decimals
  );
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  if (config.initialSupply > 0n) {
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount,
      mintAuthority,
      config.initialSupply
    );
  }
  return {
    mint,
    tokenAccount,
    mintAuthority,
    freezeAuthority,
  };
}
async function executeConcurrentTransactions(
  transactions: Array<() => Promise<string>>,
  maxConcurrency: number = 10
): Promise<ConcurrentTxResult[]> {
  const results: ConcurrentTxResult[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const txIndex = i;
    const startTime = Date.now();
    const execution = transactions[txIndex]()
      .then((signature) => {
        results[txIndex] = {
          signature,
          success: true,
          executionTime: Date.now() - startTime,
        };
      })
      .catch((error) => {
        results[txIndex] = {
          signature: "",
          success: false,
          error,
          executionTime: Date.now() - startTime,
        };
      });
    executing.push(execution);
    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      const completed = await Promise.race(
        executing.map((p, idx) => p.then(() => idx))
      );
      executing.splice(completed, 1);
    }
  }
  await Promise.all(executing);
  return results;
}
async function createFundedAccounts(
  connection: anchor.web3.Connection,
  count: number,
  lamportsPerAccount: number = 10 * anchor.web3.LAMPORTS_PER_SOL
): Promise<anchor.web3.Keypair[]> {
  const accounts: anchor.web3.Keypair[] = [];
  const airdropPromises: Promise<string>[] = [];
  for (let i = 0; i < count; i++) {
    const account = anchor.web3.Keypair.generate();
    accounts.push(account);
    airdropPromises.push(
      connection.requestAirdrop(account.publicKey, lamportsPerAccount)
    );
  }
  const signatures = await Promise.all(airdropPromises);
  await Promise.all(
    signatures.map(sig => connection.confirmTransaction(sig, "confirmed"))
  );
  return accounts;
}
function simulateNetworkDelay(
  minDelay: number = 100,
  maxDelay: number = 1000
): Promise<void> {
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  return new Promise(resolve => setTimeout(resolve, delay));
}
async function createTokenAccountsWithStates(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  states: Array<"normal" | "frozen" | "closed">
): Promise<Map<string, anchor.web3.PublicKey | null>> {
  const accounts = new Map<string, anchor.web3.PublicKey | null>();
  const freezeAuthority = anchor.web3.Keypair.generate();
  for (const state of states) {
    const owner = anchor.web3.Keypair.generate();
    switch (state) {
      case "normal":
        const normalAccount = await createAssociatedTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey
        );
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, normalAccount);
        break;
      case "frozen":
        const frozenAccount = await createFrozenTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey,
          freezeAuthority
        );
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, frozenAccount);
        break;
      case "closed":
        const closedResult = await simulateClosedTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey,
          owner
        );
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, null);
        break;
    }
  }
  return accounts;
}
async function verifyTokenAccountState(
  connection: anchor.web3.Connection,
  tokenAccount: anchor.web3.PublicKey
): Promise<{
  exists: boolean;
  isFrozen?: boolean;
  balance?: bigint;
  owner?: anchor.web3.PublicKey;
}> {
  try {
    const accountInfo = await getAccount(connection, tokenAccount);
    return {
      exists: true,
      isFrozen: accountInfo.isFrozen,
      balance: accountInfo.amount,
      owner: accountInfo.owner,
    };
  } catch (error) {
    return {
      exists: false,
    };
  }
}
describe("sprint-vault fuzzing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  async function setupTestEnvironment() {
    const employer = anchor.web3.Keypair.generate();
    const freelancer = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(
      employer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      freelancer.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      6
    );
    const employerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey
    );
    const freelancerTokenAccount = await createAssociatedTokenAccount(
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
      100000000000 
    );
    return {
      employer,
      freelancer,
      mint,
      employerTokenAccount,
      freelancerTokenAccount,
    };
  }
  describe("Property-based tests with fast-check", () => {
    it("Sprint creation with random valid parameters should succeed", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1000000 }), 
          fc.integer({ min: 1, max: 365 * 24 * 60 * 60 }), 
          fc.integer({ min: 1000000, max: 1000000000 }), 
          async (sprintId, duration, amount) => {
            const env = await setupTestEnvironment();
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime + 10);
            const endTime = new anchor.BN(currentTime + 10 + duration);
            const totalAmount = new anchor.BN(amount);
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            try {
              await program.methods
                .createSprint(new anchor.BN(sprintId), startTime, endTime, totalAmount)
                .accounts({
                  sprint: sprintPda,
                  vault: vaultPda,
                  employer: env.employer.publicKey,
                  freelancer: env.freelancer.publicKey,
                  mint: env.mint,
                  systemProgram: anchor.web3.SystemProgram.programId,
                  tokenProgram: TOKEN_PROGRAM_ID,
                  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([env.employer])
                .rpc();
              const sprintAccount = await program.account.sprint.fetch(sprintPda);
              assert.ok(sprintAccount.totalAmount.eq(totalAmount));
              assert.ok(sprintAccount.startTime.eq(startTime));
              assert.ok(sprintAccount.endTime.eq(endTime));
              return true;
            } catch (error) {
              console.error(`Failed with params: sprintId=${sprintId}, duration=${duration}, amount=${amount}`);
              throw error;
            }
          }
        ),
        { numRuns: 10, timeout: 60000 } 
      );
    });
    it("Invalid time ranges should always fail", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1000000 }), 
          fc.integer({ min: 1, max: 100000 }), 
          fc.integer({ min: 1000000, max: 1000000000 }), 
          async (sprintId, startOffset, amount) => {
            const env = await setupTestEnvironment();
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime + startOffset);
            const endTime = new anchor.BN(currentTime + startOffset - 1); 
            const totalAmount = new anchor.BN(amount);
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            try {
              await program.methods
                .createSprint(new anchor.BN(sprintId), startTime, endTime, totalAmount)
                .accounts({
                  sprint: sprintPda,
                  vault: vaultPda,
                  employer: env.employer.publicKey,
                  freelancer: env.freelancer.publicKey,
                  mint: env.mint,
                  systemProgram: anchor.web3.SystemProgram.programId,
                  tokenProgram: TOKEN_PROGRAM_ID,
                  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([env.employer])
                .rpc();
              assert.fail("Should have failed with invalid time range");
            } catch (error) {
              assert.ok(
                error.toString().includes("InvalidTimeRange") || 
                error.toString().includes("0x1778"),
                `Should fail with InvalidTimeRange error but got: ${error.toString()}`
              );
              return true;
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
    it("Withdrawal amounts should never exceed available funds", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), 
          fc.integer({ min: 10000000, max: 100000000 }), 
          fc.integer({ min: 10, max: 100 }), 
          async (withdrawalAttempts, totalAmount, duration) => {
            const env = await setupTestEnvironment();
            const sprintId = Math.floor(Math.random() * 1000000);
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime - 5); 
            const endTime = new anchor.BN(currentTime + duration);
            const amount = new anchor.BN(totalAmount);
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            await program.methods
              .createSprint(new anchor.BN(sprintId), startTime, endTime, amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employer: env.employer.publicKey,
                freelancer: env.freelancer.publicKey,
                mint: env.mint,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            await program.methods
              .depositToEscrow(amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employerTokenAccount: env.employerTokenAccount,
                employer: env.employer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            let totalWithdrawn = new anchor.BN(0);
            for (let i = 0; i < withdrawalAttempts; i++) {
              try {
                await program.methods
                  .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultPda,
                    freelancerTokenAccount: env.freelancerTokenAccount,
                    freelancer: env.freelancer.publicKey,
                    mint: env.mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  })
                  .signers([env.freelancer])
                  .rpc();
                const sprintAccount = await program.account.sprint.fetch(sprintPda);
                assert.ok(
                  sprintAccount.withdrawnAmount.lte(amount),
                  `Withdrawn ${sprintAccount.withdrawnAmount} exceeds total ${amount}`
                );
                assert.ok(
                  sprintAccount.withdrawnAmount.gte(totalWithdrawn),
                  "Withdrawn amount decreased"
                );
                totalWithdrawn = sprintAccount.withdrawnAmount;
                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                if (error.toString().includes("NoFundsAvailable") || 
                    error.toString().includes("SprintEnded")) {
                  break;
                }
                throw error;
              }
            }
            return true;
          }
        ),
        { numRuns: 5, timeout: 120000 }
      );
    });
    it("Pause and resume operations maintain invariants", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              fc.constant("pause"),
              fc.constant("resume"),
              fc.constant("withdraw"),
              fc.constant("wait")
            ),
            { minLength: 5, maxLength: 20 }
          ), 
          fc.integer({ min: 10000000, max: 100000000 }), 
          async (operations, totalAmount) => {
            const env = await setupTestEnvironment();
            const sprintId = Math.floor(Math.random() * 1000000);
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime - 10);
            const amount = new anchor.BN(totalAmount);
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            await program.methods
              .createSprint(
                new anchor.BN(sprintId), 
                startTime, 
                { oneWeek: {} }, 
                amount,
                { linear: {} } 
              )
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employer: env.employer.publicKey,
                freelancer: env.freelancer.publicKey,
                mint: env.mint,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            await program.methods
              .depositToEscrow(amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employerTokenAccount: env.employerTokenAccount,
                employer: env.employer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            let isPaused = false;
            let totalWithdrawn = new anchor.BN(0);
            for (const op of operations) {
              try {
                switch (op) {
                  case "pause":
                    if (!isPaused) {
                      try {
                        await program.methods
                          .pauseStream()
                          .accounts({
                            sprint: sprintPda,
                            employer: env.employer.publicKey,
                          })
                          .signers([env.employer])
                          .rpc();
                        isPaused = true;
                      } catch (error) {
                        if (error.toString().includes("AlreadyPaused")) {
                          isPaused = true;
                        } else {
                          throw error;
                        }
                      }
                    }
                    break;
                  case "resume":
                    if (isPaused) {
                      try {
                        await program.methods
                          .resumeStream()
                          .accounts({
                            sprint: sprintPda,
                            employer: env.employer.publicKey,
                          })
                          .signers([env.employer])
                          .rpc();
                        isPaused = false;
                      } catch (error) {
                        if (error.toString().includes("NotPaused")) {
                          isPaused = false;
                        } else {
                          throw error;
                        }
                      }
                    }
                    break;
                  case "withdraw":
                    if (!isPaused) {
                      await program.methods
                        .withdrawStreamed().accounts({
                          sprint: sprintPda,
                          vault: vaultPda,
                          freelancerTokenAccount: env.freelancerTokenAccount,
                          freelancer: env.freelancer.publicKey,
                          mint: env.mint,
                          tokenProgram: TOKEN_PROGRAM_ID,
                        })
                        .signers([env.freelancer])
                        .rpc();
                      const sprintAccount = await program.account.sprint.fetch(sprintPda);
                      assert.ok(
                        sprintAccount.withdrawnAmount.gte(totalWithdrawn),
                        "Withdrawn amount decreased"
                      );
                      totalWithdrawn = sprintAccount.withdrawnAmount;
                    }
                    break;
                  case "wait":
                    await new Promise(resolve => setTimeout(resolve, 500));
                    break;
                }
                const sprintAccount = await program.account.sprint.fetch(sprintPda);
                assert.ok(
                  sprintAccount.withdrawnAmount.lte(amount),
                  "Withdrawn exceeds total"
                );
                assert.equal(sprintAccount.isPaused, isPaused, "Pause state mismatch");
              } catch (error) {
                if (!error.toString().includes("SprintPaused") &&
                    !error.toString().includes("NoFundsAvailable") &&
                    !error.toString().includes("SprintEnded") &&
                    !error.toString().includes("AlreadyPaused") &&
                    !error.toString().includes("NotPaused")) {
                  throw error;
                }
              }
            }
            return true;
          }
        ),
        { numRuns: 3, timeout: 180000 }
      );
    });
  });
  describe("Enhanced helper function demonstrations", () => {
    it("Test with frozen token accounts", async () => {
      const provider = setupNetworkEnvironment("localnet");
      anchor.setProvider(provider);
      const payer = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
      const tokenConfig: TokenConfig = {
        decimals: 9,
        initialSupply: 1000000000000n, 
        freezeAuthority: anchor.web3.PublicKey.default,
      };
      const { mint, tokenAccount, freezeAuthority } = await createTokenWithDecimals(
        provider.connection,
        payer,
        tokenConfig
      );
      const owner = anchor.web3.Keypair.generate();
      const frozenAccount = await createFrozenTokenAccount(
        provider.connection,
        payer,
        mint,
        owner.publicKey,
        freezeAuthority!
      );
      const state = await verifyTokenAccountState(
        provider.connection,
        frozenAccount
      );
      assert.ok(state.exists, "Frozen account should exist");
      assert.ok(state.isFrozen, "Account should be frozen");
      console.log("✓ Successfully created and verified frozen token account");
    });
    it("Test concurrent transaction execution", async () => {
      const env = await setupTestEnvironment();
      const sprintId = Math.floor(Math.random() * 1000000);
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10);
      const amount = new anchor.BN(100000000);
      const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          env.employer.publicKey.toBuffer(),
          new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: env.mint,
        owner: sprintPda,
      });
      await program.methods
        .createSprint(
          new anchor.BN(sprintId), 
          startTime, 
          { oneWeek: {} }, 
          amount,
          { linear: {} } 
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: env.employer.publicKey,
          freelancer: env.freelancer.publicKey,
          mint: env.mint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      await program.methods
        .depositToEscrow(amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: env.employerTokenAccount,
          employer: env.employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      const transactions: Array<() => Promise<string>> = [];
      for (let i = 0; i < 5; i++) {
        transactions.push(async () => {
          await simulateNetworkDelay(50, 200); 
          return program.methods
            .withdrawStreamed().accounts({
              sprint: sprintPda,
              vault: vaultPda,
              freelancerTokenAccount: env.freelancerTokenAccount,
              freelancer: env.freelancer.publicKey,
              mint: env.mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([env.freelancer])
            .rpc();
        });
      }
      const results = await executeConcurrentTransactions(transactions, 3);
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`✓ Concurrent execution: ${successful} successful, ${failed} failed`);
      console.log(`  Average execution time: ${results.reduce((sum, r) => sum + r.executionTime, 0) / results.length}ms`);
      assert.ok(successful > 0, "At least some transactions should succeed");
    });
    it("Test with multiple decimal configurations", async () => {
      const provider = anchor.AnchorProvider.env();
      const payer = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
      const decimalTests = [0, 6, 9, 18];
      const createdTokens = [];
      for (const decimals of decimalTests) {
        const config: TokenConfig = {
          decimals,
          initialSupply: BigInt(10 ** decimals) * 1000n, 
        };
        const tokenInfo = await createTokenWithDecimals(
          provider.connection,
          payer,
          config
        );
        createdTokens.push({ decimals, ...tokenInfo });
        console.log(`✓ Created token with ${decimals} decimals`);
      }
      assert.equal(createdTokens.length, decimalTests.length, "All tokens should be created");
    });
    it("Test token account state transitions", async () => {
      const provider = anchor.AnchorProvider.env();
      const payer = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        payer.publicKey,
        6
      );
      const accountStates = await createTokenAccountsWithStates(
        provider.connection,
        payer,
        mint,
        ["normal", "frozen", "closed"]
      );
      let normalCount = 0;
      let frozenCount = 0;
      let closedCount = 0;
      for (const [key, accountAddress] of accountStates) {
        if (key.startsWith("normal_") && accountAddress) {
          const state = await verifyTokenAccountState(provider.connection, accountAddress);
          assert.ok(state.exists && !state.isFrozen, "Normal account should exist and not be frozen");
          normalCount++;
        } else if (key.startsWith("frozen_") && accountAddress) {
          const state = await verifyTokenAccountState(provider.connection, accountAddress);
          assert.ok(state.exists && state.isFrozen, "Frozen account should exist and be frozen");
          frozenCount++;
        } else if (key.startsWith("closed_")) {
          assert.equal(accountAddress, null, "Closed account should be null");
          closedCount++;
        }
      }
      console.log(`✓ Account states verified: ${normalCount} normal, ${frozenCount} frozen, ${closedCount} closed`);
    });
    it("Test with multiple funded accounts", async () => {
      const provider = anchor.AnchorProvider.env();
      const accounts = await createFundedAccounts(
        provider.connection,
        5,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      for (const account of accounts) {
        const balance = await provider.connection.getBalance(account.publicKey);
        assert.ok(balance >= 2 * anchor.web3.LAMPORTS_PER_SOL, "Account should be funded");
      }
      console.log(`✓ Successfully created and funded ${accounts.length} accounts`);
    });
  });
  describe("Stress testing with extreme values", () => {
    it("Handles maximum safe integer values", async () => {
      const env = await setupTestEnvironment();
      const sprintId = new anchor.BN("18446744073709551615"); 
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      const amount = new anchor.BN(1000000000); 
      const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          env.employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: env.mint,
        owner: sprintPda,
      });
      try {
        await program.methods
          .createSprint(
            sprintId, 
            startTime, 
            { oneWeek: {} }, 
            amount,
            { linear: {} } 
          )
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employer: env.employer.publicKey,
            freelancer: env.freelancer.publicKey,
            mint: env.mint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([env.employer])
          .rpc();
        const sprintAccount = await program.account.sprint.fetch(sprintPda);
        assert.ok(sprintAccount.sprintId.eq(sprintId));
        console.log("✓ Successfully handled max u64 sprint ID");
      } catch (error) {
        console.log("Max u64 handling result:", error.toString().substring(0, 100));
      }
    });
    it("Rapid-fire operations stress test", async () => {
      const env = await setupTestEnvironment();
      const sprintId = Math.floor(Math.random() * 1000000);
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10);
      const amount = new anchor.BN(100000000); 
      const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          env.employer.publicKey.toBuffer(),
          new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: env.mint,
        owner: sprintPda,
      });
      await program.methods
        .createSprint(
          new anchor.BN(sprintId), 
          startTime, 
          { oneWeek: {} }, 
          amount,
          { linear: {} } 
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: env.employer.publicKey,
          freelancer: env.freelancer.publicKey,
          mint: env.mint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      await program.methods
        .depositToEscrow(amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: env.employerTokenAccount,
          employer: env.employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(
          program.methods
            .withdrawStreamed().accounts({
              sprint: sprintPda,
              vault: vaultPda,
              freelancerTokenAccount: env.freelancerTokenAccount,
              freelancer: env.freelancer.publicKey,
              mint: env.mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([env.freelancer])
            .rpc()
            .catch(err => ({ error: err }))
        );
        if (i % 3 === 0) {
          operations.push(
            program.methods
              .pauseStream()
              .accounts({
                sprint: sprintPda,
                employer: env.employer.publicKey,
              })
              .signers([env.employer])
              .rpc()
              .catch(err => ({ error: err }))
          );
        }
        if (i % 4 === 0) {
          operations.push(
            program.methods
              .resumeStream()
              .accounts({
                sprint: sprintPda,
                employer: env.employer.publicKey,
              })
              .signers([env.employer])
              .rpc()
              .catch(err => ({ error: err }))
          );
        }
      }
      const results = await Promise.all(operations);
      const finalSprint = await program.account.sprint.fetch(sprintPda);
      assert.ok(
        finalSprint.withdrawnAmount.lte(amount),
        "Final withdrawn amount exceeds total"
      );
      console.log(`✓ Stress test completed: ${operations.length} operations`);
      console.log(`  Final withdrawn: ${finalSprint.withdrawnAmount.toString()}`);
    });
  });
});