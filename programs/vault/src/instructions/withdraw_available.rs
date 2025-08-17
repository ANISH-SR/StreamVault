use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
#[derive(Accounts)]
pub struct WithdrawAvailable<'info> {
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
    #[account(mut)]
    pub withdrawer: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = escrow_vault.token_mint,
        associated_token::authority = withdrawer
    )]
    pub withdrawer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
pub fn handler(ctx: Context<WithdrawAvailable>, max_amount: Option<u64>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_vault;
    let clock = Clock::get()?;
    require!(
        escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::Funded,
        VaultError::InvalidStatus
    );
    let can_withdraw = escrow.can_withdraw(&ctx.accounts.withdrawer.key())?;
    require!(can_withdraw, VaultError::Unauthorized);
    let available = escrow.calculate_available(clock.unix_timestamp)?;
    let withdraw_amount = if let Some(max) = max_amount {
        available.min(max)
    } else {
        available
    };
    require!(withdraw_amount > 0, VaultError::InvalidAmount);
    let vault_balance = ctx.accounts.vault_token_account.amount;
    require!(
        vault_balance >= withdraw_amount,
        VaultError::InsufficientFunds
    );
    let owner_program = escrow.owner_program;
    let vault_id_bytes = escrow.vault_id.to_le_bytes();
    let seeds = &[
        b"escrow_vault",
        owner_program.as_ref(),
        vault_id_bytes.as_ref(),
        &[escrow.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.withdrawer_token_account.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, withdraw_amount)?;
    escrow.released_amount = escrow.released_amount
        .checked_add(withdraw_amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    escrow.updated_at = clock.unix_timestamp;
    if escrow.released_amount == escrow.total_amount {
        escrow.status = EscrowStatus::Completed;
        msg!("Escrow fully withdrawn and completed");
    }
    msg!("Withdrew {} tokens from escrow vault {}", 
        withdraw_amount, 
        escrow.vault_id
    );
    Ok(())
}