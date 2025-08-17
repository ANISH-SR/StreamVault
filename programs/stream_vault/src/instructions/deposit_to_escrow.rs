use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Stream;
use crate::errors::StreamVaultError;
use crate::utils::{get_current_time, validate_token_account_not_frozen};
#[derive(Accounts)]
pub struct DepositToEscrow<'info> {
    #[account(
        mut,
        seeds = [b"stream", employer.key().as_ref(), stream.stream_id.to_le_bytes().as_ref()],
        bump = stream.bump,
        has_one = employer,
        has_one = vault,
    )]
    pub stream: Account<'info, Stream>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub employer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub employer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}
pub fn handler(ctx: Context<DepositToEscrow>, amount: u64) -> Result<()> {
    let stream = &mut ctx.accounts.stream;
    let current_time = get_current_time()?;
    validate_token_account_not_frozen(&ctx.accounts.employer_token_account)?;
    validate_token_account_not_frozen(&ctx.accounts.vault)?;
    require!(
        ctx.accounts.employer_token_account.amount >= stream.total_amount,
        StreamVaultError::InsufficientFunds
    );
    if stream.is_funded {
        return Err(error!(StreamVaultError::StreamAlreadyFunded));
    }
    if stream.start_time <= current_time && !stream.is_paused {
        return Err(error!(StreamVaultError::StreamAlreadyStarted));
    }
    if amount != stream.total_amount {
        msg!(
            "Must deposit exact amount. Expected: {}, Received: {}",
            stream.total_amount,
            amount
        );
        return Err(error!(StreamVaultError::InvalidAmount));
    }
    let cpi_accounts = Transfer {
        from: ctx.accounts.employer_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.employer.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    stream.is_funded = true;
    msg!(
        "Stream {} fully funded with {} tokens",
        stream.stream_id,
        amount
    );
    Ok(())
}