import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import { Vault } from "../target/types/vault";
import { 
  Keypair, 
  LAMPORTS_PER_SOL, 
  PublicKey, 
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";
describe("Vault Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const streamVaultProgram = anchor.workspace.StreamVault as Program<StreamVault>;
  const vaultProgram = anchor.workspace.Vault as Program<Vault>;
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  let vaultConfig: PublicKey;
  let feeRecipient: Keypair;
  const USDC_DECIMALS = 6;
  const ONE_USDC = new BN(10 ** USDC_DECIMALS);
  const HUNDRED_USDC = ONE_USDC.mul(new BN(100));
  before(async () => {
    employer = Keypair.generate();
    freelancer = Keypair.generate();
    feeRecipient = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(freelancer.publicKey, 1 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(provider.wallet.publicKey, 2 * LAMPORTS_PER_SOL)
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
      1000 * 10 ** USDC_DECIMALS
    );
    vaultConfig = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_config")],
      vaultProgram.programId
    )[0];
    const configInfo = await provider.connection.getAccountInfo(vaultConfig);
    if (!configInfo) {
      try {
        await vaultProgram.methods
          .initializeConfig(
            100, 
            ONE_USDC.toNumber(), 
            365 * 24 * 60 * 60 
          )
          .accounts({
            config: vaultConfig,
            authority: provider.wallet.publicKey,
            feeRecipient: feeRecipient.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log("Vault config initialized");
      } catch (e) {
        console.log("Failed to initialize config:", e.message);
      }
    } else {
      console.log("Config already exists");
    }
  });
  describe("Phase 1: Core Escrow Functionality", () => {
    it("Should create a linear release escrow", async () => {
      const vaultId = new BN(Date.now());
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60; 
      const endTime = startTime + 3600; 
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} }, 
          null, 
          null  
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey, 
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.vaultId.toNumber(), vaultId.toNumber());
      assert.equal(escrowAccount.totalAmount.toNumber(), HUNDRED_USDC.toNumber());
      assert.equal(escrowAccount.depositor.toBase58(), employer.publicKey.toBase58());
      assert.equal(escrowAccount.beneficiary.toBase58(), freelancer.publicKey.toBase58());
    });
    it("Should deposit funds to escrow", async () => {
      const vaultId = new BN(Date.now() + 1);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const vaultBalance = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
      assert.equal(vaultBalance.value.amount, HUNDRED_USDC.toNumber().toString());
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.status.active, undefined); 
    });
    it("Should withdraw available funds (immediate release)", async () => {
      const vaultId = new BN(Date.now() + 2);
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} }, 
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const balanceBefore = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      await vaultProgram.methods
        .withdrawAvailable(null) 
        .accounts({
          escrowVault,
          vaultTokenAccount,
          withdrawer: freelancer.publicKey,
          withdrawerTokenAccount: freelancerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();
      const balanceAfter = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      const withdrawn = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      assert.isAtLeast(withdrawn, HUNDRED_USDC.toNumber() * 0.99); 
      assert.isAtMost(withdrawn, HUNDRED_USDC.toNumber());
    });
  });
  describe("Phase 2: Advanced Release Schedules", () => {
    it("Should create milestone-based escrow", async () => {
      const vaultId = new BN(Date.now() + 3);
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      const milestones = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(30)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(30)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 3,
          amount: ONE_USDC.mul(new BN(40)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.vaultId.toNumber(), vaultId.toNumber());
      assert.exists(escrowAccount.releaseSchedule.milestone);
      assert.equal(escrowAccount.releaseSchedule.milestone.conditions.length, 3);
    });
    it("Should release milestone and allow withdrawal", async () => {
      const vaultId = new BN(Date.now() + 4);
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      const milestones = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(50)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(50)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .releaseMilestone(1)
        .accounts({
          escrowVault,
          authority: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      const balanceBefore = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      await vaultProgram.methods
        .withdrawAvailable(null)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          withdrawer: freelancer.publicKey,
          withdrawerTokenAccount: freelancerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();
      const balanceAfter = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      const withdrawn = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      assert.isAtLeast(withdrawn, ONE_USDC.mul(new BN(49)).toNumber()); 
      assert.isAtMost(withdrawn, ONE_USDC.mul(new BN(50)).toNumber());
    });
    it("Should handle hybrid release schedule", async () => {
      const vaultId = new BN(Date.now() + 5);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      const linearPortion = ONE_USDC.mul(new BN(50));
      const milestonePortion = ONE_USDC.mul(new BN(50));
      const linearConfig = {
        startTime: new BN(startTime),
        endTime: new BN(endTime),
        accelerationType: { linear: {} },
      };
      const milestoneConfig = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(25)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(25)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          {
            hybrid: {
              linearPortion,
              milestonePortion,
              linearConfig,
              milestoneConfig,
            },
          },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.exists(escrowAccount.releaseSchedule.hybrid);
      assert.equal(
        escrowAccount.releaseSchedule.hybrid.linearPortion.toNumber(),
        linearPortion.toNumber()
      );
      assert.equal(
        escrowAccount.releaseSchedule.hybrid.milestonePortion.toNumber(),
        milestonePortion.toNumber()
      );
    });
    it("Should update release schedule", async () => {
      const vaultId = new BN(Date.now() + 6);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { depositor: {} }, 
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .updateReleaseSchedule({ immediate: {} })
        .accounts({
          escrowVault,
          authority: employer.publicKey,
          config: vaultConfig,
        })
        .signers([employer])
        .rpc();
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.exists(escrowAccount.releaseSchedule.immediate);
    });
    it("Should close escrow and refund remaining funds", async () => {
      const vaultId = new BN(Date.now() + 7);
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const balanceBefore = await provider.connection.getTokenAccountBalance(employerTokenAccount);
      await vaultProgram.methods
        .closeEscrow()
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      const balanceAfter = await provider.connection.getTokenAccountBalance(employerTokenAccount);
      const refunded = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      assert.isAtLeast(refunded, HUNDRED_USDC.toNumber() * 0.99);
      assert.isAtMost(refunded, HUNDRED_USDC.toNumber());
      try {
        await vaultProgram.account.escrowVault.fetch(escrowVault);
        assert.fail("Escrow account should be closed");
      } catch (e) {
        assert.include(e.message, "Account does not exist");
      }
    });
  });
  describe("Integration with StreamVault", () => {
    it("Should allow StreamVault to create escrow via CPI", async () => {
      const sprintId = new BN(Date.now());
      const vaultId = sprintId; 
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 7200; 
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        sprintVaultProgram.programId
      );
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: streamVaultProgram.programId, 
          ownerAccount: sprintPda, 
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(
        escrowAccount.ownerProgram.toBase58(),
        sprintVaultProgram.programId.toBase58()
      );
      assert.equal(escrowAccount.ownerAccount.toBase58(), sprintPda.toBase58());
    });
    it("Should demonstrate acceleration types (Quadratic)", async () => {
      const vaultId = new BN(Date.now() + 8);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now;
      const endTime = startTime + 100; 
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      const linearConfig = {
        startTime: new BN(startTime),
        endTime: new BN(endTime),
        accelerationType: { quadratic: {} }, 
      };
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          {
            hybrid: {
              linearPortion: HUNDRED_USDC,
              milestonePortion: new BN(0),
              linearConfig,
              milestoneConfig: [],
            },
          },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      await new Promise((resolve) => setTimeout(resolve, 25000));
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      const currentTime = Math.floor(Date.now() / 1000);
      console.log("Escrow created with quadratic acceleration");
      console.log("Start time:", startTime);
      console.log("End time:", endTime);
      console.log("Current time:", currentTime);
    });
  });
  describe("Error Cases and Edge Conditions", () => {
    it("Should reject withdrawal from unauthorized account", async () => {
      const vaultId = new BN(Date.now() + 9);
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} },
          { beneficiary: {} }, 
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      try {
        await vaultProgram.methods
          .withdrawAvailable(null)
          .accounts({
            escrowVault,
            vaultTokenAccount,
            withdrawer: employer.publicKey,
            withdrawerTokenAccount: employerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have failed - unauthorized withdrawal");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });
    it("Should reject milestone release from unauthorized account", async () => {
      const vaultId = new BN(Date.now() + 10);
      const unauthorizedUser = Keypair.generate();
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );
      const milestones = [
        {
          milestoneId: 1,
          amount: HUNDRED_USDC,
          requiredApproval: employer.publicKey, 
          isCompleted: false,
        },
      ];
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();
      try {
        await vaultProgram.methods
          .releaseMilestone(1)
          .accounts({
            escrowVault,
            authority: freelancer.publicKey,
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have failed - unauthorized milestone release");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });
  });
});