use anchor_lang::prelude::*;
use crate::state::Stream;
use crate::utils::get_current_time;
use crate::errors::StreamVaultError;
use crate::constants::MAX_PAUSE_RESUME_COUNT;
#[derive(Accounts)]
pub struct PauseStream<'info> {
    #[account(
        mut,
        seeds = [b"stream", employer.key().as_ref(), stream.stream_id.to_le_bytes().as_ref()],
        bump = stream.bump,
        has_one = employer,
    )]
    pub stream: Account<'info, Stream>,
    #[account(mut)]
    pub employer: Signer<'info>,
}
pub fn handler(ctx: Context<PauseStream>) -> Result<()> {
    let stream = &mut ctx.accounts.stream;
    let current_time = get_current_time()?;
    let current_slot = Clock::get()?.slot;
    require!(
        stream.last_operation_slot != current_slot,
        StreamVaultError::ConcurrentOperation
    );
    if !stream.is_funded {
        return Err(error!(StreamVaultError::StreamNotFunded));
    }
    if stream.should_auto_close(current_time)? {
        return Err(error!(StreamVaultError::StreamAutoClosedDueToExcessivePause));
    }
    if stream.pause_resume_count >= MAX_PAUSE_RESUME_COUNT {
        return Err(error!(StreamVaultError::MaxPauseResumeExceeded));
    }
    stream.pause(current_time)?;
    stream.pause_resume_count = stream.pause_resume_count
        .checked_add(1)
        .ok_or(error!(StreamVaultError::MathOverflow))?;
    stream.last_operation_slot = current_slot;
    msg!(
        "Stream paused: ID={}, employer={}, pause_time={}",
        stream.stream_id,
        ctx.accounts.employer.key(),
        stream.pause_time.unwrap_or(-1)
    );
    Ok(())
}