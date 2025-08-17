use anchor_lang::prelude::*;
mod constants;
mod errors;
mod instructions;
mod state;
mod strategies;
mod utils;
use instructions::*;
use state::StreamDuration;
use strategies::AccelerationType;
declare_id!("Cp34F2Ho7oCetL6UkfFDLyGfvh5FcPuRiT1DSHiEAVbF");
#[program]
pub mod stream_vault {
    use super::*;
    pub fn create_stream(
        ctx: Context<CreateStream>,
        stream_id: u64,
        start_time: i64,
        stream_duration: StreamDuration,
        total_amount: u64,
        acceleration_type: Option<AccelerationType>,
    ) -> Result<()> {
        instructions::create_stream::handler(ctx, stream_id, start_time, stream_duration, total_amount, acceleration_type)
    }
    pub fn deposit_to_escrow(ctx: Context<DepositToEscrow>, amount: u64) -> Result<()> {
        instructions::deposit_to_escrow::handler(ctx, amount)
    }
    pub fn withdraw_streamed(ctx: Context<WithdrawStreamed>) -> Result<()> {
        instructions::withdraw_streamed::handler(ctx)
    }
    pub fn pause_stream(ctx: Context<PauseStream>) -> Result<()> {
        instructions::pause_stream::handler(ctx)
    }
    pub fn resume_stream(ctx: Context<ResumeStream>) -> Result<()> {
        instructions::resume_stream::handler(ctx)
    }
    pub fn close_stream(ctx: Context<CloseStream>) -> Result<()> {
        instructions::close_stream::handler(ctx)
    }
}