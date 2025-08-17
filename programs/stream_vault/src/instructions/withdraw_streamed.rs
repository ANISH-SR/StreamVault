use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use crate::state::Stream;
use crate::errors::StreamVaultError;
use crate::utils::{get_current_time, is_dust_amount, round_amount_for_precision};
use crate::constants::get_min_withdrawal_amount;
#[derive(Accounts)]
pub struct WithdrawStreamed<'info> {
    #[account(
        mut,
        seeds = [b"stream", stream.employer.as_ref(), stream.stream_id.to_le_bytes().as_ref()],
        bump = stream.bump,
        has_one = freelancer,
        has_one = vault,
        has_one = mint,
    )]
    pub stream: Account<'info, Stream>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = freelancer_token_account.owner == freelancer.key() @ StreamVaultError::Unauthorized,
        constraint = freelancer_token_account.mint == stream.mint @ StreamVaultError::InvalidMint,
    )]
    pub freelancer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub freelancer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawStreamed>) -> Result<()> {
    // Take all immutable borrows first
    let stream_info = &ctx.accounts.stream;
    if !stream_info.is_funded {
        return Err(error!(StreamVaultError::StreamNotFunded));
    }
    if stream_info.is_paused {
        return Err(error!(StreamVaultError::StreamPaused));
    }
    let current_time = get_current_time()?;
    if stream_info.start_time > current_time {
        return Err(error!(StreamVaultError::StreamNotStarted));
    }
    let withdrawable = stream_info.calculate_withdrawable_amount(current_time)?;
    if !stream_info.has_remaining_funds() {
        return Err(error!(StreamVaultError::NoFundsAvailable));
    }
    
    // Get stream data needed for seeds before mutable borrow
    let stream_pubkey = stream_info.key();
    let bump = stream_info.bump;
    let signer: &[&[&[u8]]] = &[&[b"stream", stream_pubkey.as_ref(), &[bump]]];
    
    // Now perform mutable operations
    let withdrawable_amount = round_amount_for_precision(withdrawable, ctx.accounts.mint.decimals);
    
    // Check minimum withdrawal before creating the CPI context
    if withdrawable_amount < get_min_withdrawal_amount(&ctx.accounts.mint.key()) {
        // Now we can take a mutable reference since we're done with immutable borrows
        let stream = &mut ctx.accounts.stream;
        stream.accumulated_dust = stream.accumulated_dust
            .checked_add(withdrawable_amount)
            .ok_or(error!(StreamVaultError::MathOverflow))?;
        return Err(error!(StreamVaultError::BelowMinimumWithdrawal));
    }

    // Prepare CPI accounts
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.freelancer_token_account.to_account_info(),
        authority: ctx.accounts.stream.to_account_info(),
    };

    // Perform the transfer
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, withdrawable_amount)?;

    // Update stream state after the transfer
    let stream = &mut ctx.accounts.stream;
    stream.withdrawn_amount = stream.withdrawn_amount
        .checked_add(withdrawable_amount)
        .ok_or(error!(StreamVaultError::MathOverflow))?;
    stream.last_operation_slot = Clock::get()?.slot;
    Ok(())
}