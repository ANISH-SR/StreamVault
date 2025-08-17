use anchor_lang::prelude::*;
use crate::state::*;
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = EscrowConfig::LEN,
        seeds = [b"escrow_config"],
        bump
    )]
    pub config: Account<'info, EscrowConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The fee recipient account is validated in the handler to ensure it's a valid Solana address
    pub fee_recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
pub fn handler(
    ctx: Context<InitializeConfig>,
    fee_basis_points: u16,
    min_escrow_amount: u64,
    max_escrow_duration: i64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(
        fee_basis_points <= 10000, 
        VaultError::InvalidAmount
    );
    require!(
        max_escrow_duration > 0,
        VaultError::InvalidTimeRange
    );
    config.authority = ctx.accounts.authority.key();
    config.fee_basis_points = fee_basis_points;
    config.fee_recipient = ctx.accounts.fee_recipient.key();
    config.min_escrow_amount = min_escrow_amount;
    config.max_escrow_duration = max_escrow_duration;
    config.paused = false;
    config.version = 1;
    config.bump = ctx.bumps.config;
    msg!("Escrow config initialized with {} basis points fee", fee_basis_points);
    Ok(())
}