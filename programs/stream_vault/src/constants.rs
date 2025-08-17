use anchor_lang::prelude::*;
pub const MAX_PAUSE_RESUME_COUNT: u8 = 3;
pub const MIN_WITHDRAWAL_AMOUNT_USDC: u64 = 10_000_000;
pub const MIN_WITHDRAWAL_AMOUNT_SOL: u64 = 10_000_000;
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const USDT_MINT: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
pub const USDC_MINT_DEVNET: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub fn is_supported_mint(mint: &Pubkey) -> bool {
    *mint == USDC_MINT || 
    *mint == USDT_MINT || 
    *mint == USDC_MINT_DEVNET || 
    *mint == WSOL_MINT
}
pub fn get_min_withdrawal_amount(mint: &Pubkey) -> u64 {
    if *mint == WSOL_MINT {
        MIN_WITHDRAWAL_AMOUNT_SOL
    } else {
        MIN_WITHDRAWAL_AMOUNT_USDC
    }
}