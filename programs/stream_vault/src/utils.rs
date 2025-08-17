use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use crate::errors::StreamVaultError;
pub fn validate_time_range(start_time: i64, end_time: i64, current_time: i64) -> Result<()> {
    if end_time <= start_time {
        return Err(error!(StreamVaultError::InvalidTimeRange));
    }
    if start_time < current_time {
        msg!("Warning: Sprint start time is in the past");
    }
    Ok(())
}
pub fn validate_amount(amount: u64) -> Result<()> {
    if amount == 0 {
        return Err(error!(StreamVaultError::InvalidAmount));
    }
    Ok(())
}
pub fn get_current_time() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
pub fn calculate_release_rate(total_amount: u64, start_time: i64, end_time: i64) -> Result<u64> {
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(StreamVaultError::MathOverflow)?;
    if duration == 0 {
        return Err(error!(StreamVaultError::InvalidTimeRange));
    }
    let rate = total_amount
        .checked_div(duration as u64)
        .ok_or(StreamVaultError::MathOverflow)?;
    Ok(rate)
}
pub fn get_sprint_seeds<'a>(employer: &'a Pubkey, sprint_id: u64) -> Vec<Vec<u8>> {
    vec![
        b"sprint".to_vec(),
        employer.to_bytes().to_vec(),
        sprint_id.to_le_bytes().to_vec(),
    ]
}
pub fn get_vault_seeds<'a>(sprint: &'a Pubkey) -> Vec<Vec<u8>> {
    vec![
        b"vault".to_vec(),
        sprint.as_ref().to_vec(),
    ]
}
pub fn validate_token_account_not_frozen(token_account: &Account<TokenAccount>) -> Result<()> {
    let account_info = token_account.to_account_info();
    let account_data = account_info.data.borrow();
    if account_data.len() > 108 {
        let state = account_data[108];
        require!(
            state != 2, 
            StreamVaultError::FrozenTokenAccount
        );
    }
    require!(
        token_account.owner != Pubkey::default(),
        StreamVaultError::FrozenTokenAccount
    );
    Ok(())
}
pub fn validate_mint_decimals(mint: &Account<Mint>, expected_decimals: u8) -> Result<()> {
    require!(
        mint.decimals == expected_decimals,
        StreamVaultError::InvalidTokenDecimals
    );
    Ok(())
}
pub fn get_network_cluster() -> NetworkCluster {
    #[cfg(feature = "mainnet")]
    return NetworkCluster::Mainnet;
    #[cfg(feature = "devnet")]
    return NetworkCluster::Devnet;
    NetworkCluster::Localnet
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NetworkCluster {
    Mainnet,
    Devnet,
    Testnet,
    Localnet,
}
pub fn validate_mint_for_network(mint: &Pubkey) -> Result<()> {
    use crate::constants::*;
    let cluster = get_network_cluster();
    match cluster {
        NetworkCluster::Mainnet => {
            require!(
                *mint == USDC_MINT || *mint == USDT_MINT || *mint == WSOL_MINT,
                StreamVaultError::InvalidNetworkMint
            );
        },
        NetworkCluster::Devnet => {
            require!(
                *mint == USDC_MINT_DEVNET || *mint == WSOL_MINT,
                StreamVaultError::InvalidNetworkMint
            );
        },
        NetworkCluster::Localnet => {
            msg!("Localnet: Allowing any mint for testing");
        },
        _ => {
            require!(
                is_supported_mint(mint),
                StreamVaultError::UnsupportedMint
            );
        }
    }
    Ok(())
}
pub fn get_dust_threshold(decimals: u8) -> u64 {
    match decimals {
        6 => 100,       
        9 => 100_000,   
        _ => 10_u64.pow(decimals as u32 - 4), 
    }
}
pub fn is_dust_amount(amount: u64, decimals: u8) -> bool {
    amount > 0 && amount < get_dust_threshold(decimals)
}
pub fn round_amount_for_precision(amount: u64, decimals: u8) -> u64 {
    let precision_factor = 10_u64.pow(decimals.saturating_sub(6) as u32);
    if precision_factor > 1 {
        (amount / precision_factor) * precision_factor
    } else {
        amount
    }
}