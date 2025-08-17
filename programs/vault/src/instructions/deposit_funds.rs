use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
#[derive(Accounts)]
pub struct DepositFunds<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow_vault",
            escrow_vault.owner_program.as_ref(),
            escrow_vault.vault_id.to_le_bytes().as_ref()
        ],
        bump = escrow_vault.bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,
    #[account(
        mut,
        associated_token::mint = escrow_vault.token_mint,
        associated_token::authority = escrow_vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = depositor.key() == escrow_vault.depositor @ VaultError::Unauthorized
    )]
    pub depositor: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = escrow_vault.token_mint,
        associated_token::authority = depositor
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"escrow_config"],
        bump = config.bump
    )]
    pub config: Account<'info, EscrowConfig>,
    pub token_program: Program<'info, Token>,
}
pub fn handler(ctx: Context<DepositFunds>, amount: u64) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_vault;
    let config = &ctx.accounts.config;
    let clock = Clock::get()?;
    require!(!config.paused, VaultError::ProgramPaused);
    require!(
        escrow.status == EscrowStatus::Initialized || 
        (escrow.status == EscrowStatus::Funded && amount > 0),
        VaultError::InvalidStatus
    );
    require!(amount > 0, VaultError::InvalidAmount);
    let current_balance = ctx.accounts.vault_token_account.amount;
    let expected_total = current_balance
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    require!(
        expected_total <= escrow.total_amount,
        VaultError::InvalidAmount
    );
    let fee_amount = if config.fee_basis_points > 0 {
        (amount as u128)
            .checked_mul(config.fee_basis_points as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(10000)
            .ok_or(VaultError::ArithmeticOverflow)? as u64
    } else {
        0
    };
    let deposit_amount = amount
        .checked_sub(fee_amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, deposit_amount)?;
    if fee_amount > 0 {
        msg!("Platform fee of {} tokens would be collected", fee_amount);
    }
    if current_balance.checked_add(deposit_amount).unwrap() == escrow.total_amount {
        escrow.status = EscrowStatus::Active;
        msg!("Escrow fully funded and activated");
    } else {
        escrow.status = EscrowStatus::Funded;
        msg!("Partial deposit: {} of {} tokens funded", 
            current_balance + deposit_amount, 
            escrow.total_amount
        );
    }
    escrow.updated_at = clock.unix_timestamp;
    Ok(())
}