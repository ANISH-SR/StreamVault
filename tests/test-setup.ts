import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StreamVault } from "../target/types/stream_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { USDC_MINT_DEVNET, WSOL_MINT } from "./helpers";
export interface TestContext {
  provider: anchor.AnchorProvider;
  program: Program<StreamVault>;
  employer: anchor.web3.Keypair;
  freelancer: anchor.web3.Keypair;
  mint: anchor.web3.PublicKey;
  employerTokenAccount: anchor.web3.PublicKey;
  freelancerTokenAccount: anchor.web3.PublicKey;
  sprintPda: anchor.web3.PublicKey;
  sprintBump: number;
  vaultPda: anchor.web3.PublicKey;
}
export async function createTestContext(
  useDevnetUsdc: boolean = true,
  sprintId: anchor.BN = new anchor.BN(1)
): Promise<TestContext> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.StreamVault as Program<StreamVault>;
  const employer = anchor.web3.Keypair.generate();
  const freelancer = anchor.web3.Keypair.generate();
  const airdropTx1 = await provider.connection.requestAirdrop(
    employer.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropTx1);
  const airdropTx2 = await provider.connection.requestAirdrop(
    freelancer.publicKey,
    1 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropTx2);
  const mint = useDevnetUsdc ? USDC_MINT_DEVNET : WSOL_MINT;
  let employerTokenAccount: anchor.web3.PublicKey;
  let freelancerTokenAccount: anchor.web3.PublicKey;
  if (useDevnetUsdc) {
    try {
      const mintInfo = await provider.connection.getAccountInfo(USDC_MINT_DEVNET);
      if (!mintInfo) {
        console.log("Warning: USDC_MINT_DEVNET not found, using mock mint for testing");
        const mockMint = await createMint(
          provider.connection,
          employer,
          employer.publicKey,
          null,
          6 
        );
        employerTokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          employer,
          mockMint,
          employer.publicKey
        );
        freelancerTokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          freelancer,
          mockMint,
          freelancer.publicKey
        );
        await mintTo(
          provider.connection,
          employer,
          mockMint,
          employerTokenAccount,
          employer,
          10000000000 
        );
        const finalMint = mockMint;
        const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("sprint"),
            employer.publicKey.toBuffer(),
            sprintId.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );
        const vaultPda = anchor.utils.token.associatedAddress({
          mint: finalMint,
          owner: sprintPda,
        });
        return {
          provider,
          program,
          employer,
          freelancer,
          mint: finalMint,
          employerTokenAccount,
          freelancerTokenAccount,
          sprintPda,
          sprintBump,
          vaultPda,
        };
      } else {
        employerTokenAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          employer,
          USDC_MINT_DEVNET,
          employer.publicKey
        ).then(account => account.address);
        freelancerTokenAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          freelancer,
          USDC_MINT_DEVNET,
          freelancer.publicKey
        ).then(account => account.address);
      }
    } catch (error) {
      console.log("Error checking USDC_MINT_DEVNET, creating mock mint");
      const mockMint = await createMint(
        provider.connection,
        employer,
        employer.publicKey,
        null,
        6
      );
      employerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        employer,
        mockMint,
        employer.publicKey
      );
      freelancerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        freelancer,
        mockMint,
        freelancer.publicKey
      );
      await mintTo(
        provider.connection,
        employer,
        mockMint,
        employerTokenAccount,
        employer,
        10000000000
      );
      const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: mockMint,
        owner: sprintPda,
      });
      return {
        provider,
        program,
        employer,
        freelancer,
        mint: mockMint,
        employerTokenAccount,
        freelancerTokenAccount,
        sprintPda,
        sprintBump,
        vaultPda,
      };
    }
  } else {
    employerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      employer,
      WSOL_MINT,
      employer.publicKey
    ).then(account => account.address);
    freelancerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      freelancer,
      WSOL_MINT,
      freelancer.publicKey
    ).then(account => account.address);
  }
  const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.publicKey.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const vaultPda = anchor.utils.token.associatedAddress({
    mint,
    owner: sprintPda,
  });
  return {
    provider,
    program,
    employer,
    freelancer,
    mint,
    employerTokenAccount,
    freelancerTokenAccount,
    sprintPda,
    sprintBump,
    vaultPda,
  };
}
export async function createMockMint(
  provider: anchor.AnchorProvider,
  authority: anchor.web3.Keypair,
  decimals: number = 6
): Promise<anchor.web3.PublicKey> {
  return await createMint(
    provider.connection,
    authority,
    authority.publicKey,
    null,
    decimals
  );
}