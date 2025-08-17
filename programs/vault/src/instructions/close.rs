use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::*;
#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow_vault",
            escrow_vault.owner_program.as_ref(),
            escrow_vault.vault_id.to_le_bytes().as_ref()
        ],
        bump = escrow_vault.bump,
        close = depositor
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
    pub token_program: Program<'info, Token>,
}
pub fn handler(ctx: Context<CloseEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_vault;
    require!(
        escrow.status == EscrowStatus::Completed || 
        escrow.status == EscrowStatus::Cancelled ||
        escrow.status == EscrowStatus::Active ||
        escrow.status == EscrowStatus::Funded,
        VaultError::InvalidStatus
    );
    let remaining_balance = ctx.accounts.vault_token_account.amount;
    if remaining_balance > 0 {
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
            to: ctx.accounts.depositor_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, remaining_balance)?;
        msg!("Refunded {} tokens to depositor", remaining_balance);
    }
    let close_accounts = CloseAccount {
        account: ctx.accounts.vault_token_account.to_account_info(),
        destination: ctx.accounts.depositor.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let owner_program = escrow.owner_program;
    let vault_id_bytes = escrow.vault_id.to_le_bytes();
    let seeds = &[
        b"escrow_vault",
        owner_program.as_ref(),
        vault_id_bytes.as_ref(),
        &[escrow.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, close_accounts, signer_seeds);
    token::close_account(cpi_ctx)?;
    msg!("Escrow vault {} closed", escrow.vault_id);
    Ok(())
}