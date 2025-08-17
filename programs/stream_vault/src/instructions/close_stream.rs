use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::Stream;
use crate::errors::StreamVaultError;
use crate::utils::get_current_time;

#[derive(Accounts)]
pub struct CloseStream<'info> {
    #[account(
        mut,
        seeds = [b"stream", employer.key().as_ref(), stream.stream_id.to_le_bytes().as_ref()],
        bump = stream.bump,
        has_one = employer,
        has_one = vault,
        close = employer
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

pub fn handler(ctx: Context<CloseStream>) -> Result<()> {
    let stream = &ctx.accounts.stream;
    let current_time = get_current_time()?;
    
    if !stream.is_ended(current_time) && stream.withdrawn_amount < stream.total_amount {
        return Err(error!(StreamVaultError::StreamNotEnded));
    }

    // If there are remaining funds in the vault, transfer them back to the employer
    if ctx.accounts.vault.amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.employer_token_account.to_account_info(),
            authority: ctx.accounts.stream.to_account_info(),
        };
        
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        
        token::transfer(cpi_ctx, ctx.accounts.vault.amount)?;
    }
    
    // Close the vault account
    let close_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.employer.to_account_info(),
        authority: ctx.accounts.stream.to_account_info(),
    };
    
    let seeds = &[
        b"stream",
        ctx.accounts.employer.key().as_ref(),
        &stream.stream_id.to_le_bytes(),
        &[stream.bump],
    ];
    
    let signer_seeds = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        close_accounts,
        signer_seeds,
    );
    
    token::close_account(cpi_ctx)?;
    
    msg!(
        "Stream closed: ID={}, employer={}, refunded_amount={}",
        stream.stream_id,
        ctx.accounts.employer.key(),
        ctx.accounts.vault.amount
    );
    
    Ok(())
}
