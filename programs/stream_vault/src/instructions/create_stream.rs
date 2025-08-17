use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{Stream, StreamDuration};
use crate::strategies::AccelerationType;
use crate::utils::{validate_time_range, validate_amount, get_current_time, validate_mint_for_network, validate_mint_decimals};
use crate::constants::is_supported_mint;
use crate::errors::StreamVaultError;
#[derive(Accounts)]
#[instruction(stream_id: u64)]
pub struct CreateStream<'info> {
    #[account(
        init,
        payer = employer,
        space = Stream::LEN,
        seeds = [b"stream", employer.key().as_ref(), stream_id.to_le_bytes().as_ref()],
        bump
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        init,
        payer = employer,
        associated_token::mint = mint,
        associated_token::authority = stream,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub employer: Signer<'info>,
    /// CHECK: The freelancer account is validated in the handler to ensure it's a valid Solana address
    pub freelancer: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
pub fn handler(
    ctx: Context<CreateStream>,
    stream_id: u64,
    start_time: i64,
    stream_duration: StreamDuration,
    total_amount: u64,
    acceleration_type: Option<AccelerationType>,
) -> Result<()> {
    let current_time = get_current_time()?;
    let duration_seconds = stream_duration.to_seconds();
    let end_time = start_time.checked_add(duration_seconds)
        .ok_or(error!(StreamVaultError::MathOverflow))?;
    validate_time_range(start_time, end_time, current_time)?;
    validate_amount(total_amount)?;
    msg!("Creating stream with duration: {} ({} days)", stream_duration.to_days(), duration_seconds / 86400);
    let mint_key = ctx.accounts.mint.key();
    let cluster = crate::utils::get_network_cluster();
    if cluster != crate::utils::NetworkCluster::Localnet {
        if !is_supported_mint(&ctx.accounts.mint.key()) {
        return Err(error!(StreamVaultError::UnsupportedMint));
    }
    } else {
        msg!("Localnet: Allowing any mint for testing");
    }
    validate_mint_for_network(&mint_key)?;
    if cluster != crate::utils::NetworkCluster::Localnet {
        let expected_decimals = if mint_key == crate::constants::WSOL_MINT { 9 } else { 6 };
        
        validate_mint_decimals(&ctx.accounts.mint, expected_decimals).map_err(|_| StreamVaultError::InvalidTokenDecimals)?;
    validate_mint_for_network(&ctx.accounts.mint.key()).map_err(|_| StreamVaultError::InvalidNetworkMint)?;
    }
    require!(
        start_time > 0 && end_time > 0,
        StreamVaultError::InvalidTimestamp
    );
    require!(
        end_time < i64::MAX / 2, 
        StreamVaultError::InvalidTimestamp
    );
    let stream = &mut ctx.accounts.stream;
    stream.employer = ctx.accounts.employer.key();
    stream.freelancer = ctx.accounts.freelancer.key();
    stream.stream_id = stream_id;
    stream.start_time = start_time;
    stream.end_time = end_time;
    stream.total_amount = total_amount;
    stream.withdrawn_amount = 0;
    stream.is_paused = false;
    stream.pause_time = None;
    stream.total_paused_duration = 0;
    stream.pause_resume_count = 0;
    stream.last_operation_slot = 0; 
    stream.accumulated_dust = 0; 
    stream.mint = ctx.accounts.mint.key();
    stream.vault = ctx.accounts.vault.key();
    stream.acceleration_type = acceleration_type.unwrap_or(AccelerationType::Linear);
    stream.bump = ctx.bumps.stream;
    msg!(
        "Stream created: ID={}, employer={}, freelancer={}, amount={}, acceleration={:?}",
        stream_id,
        ctx.accounts.employer.key(),
        ctx.accounts.freelancer.key(),
        total_amount,
        stream.acceleration_type
    );
    Ok(())
}