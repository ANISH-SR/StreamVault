use anchor_lang::prelude::*;
pub mod state;
pub mod instructions;
use instructions::*;
use state::*;
declare_id!("3X4cA5KNBo6yYw2aLwRgVPaX3RshUR62Y2Bo8GyXzYWg");
#[program]
pub mod vault {
    use super::*;
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_basis_points: u16,
        min_escrow_amount: u64,
        max_escrow_duration: i64,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            fee_basis_points,
            min_escrow_amount,
            max_escrow_duration,
        )
    }
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        vault_id: u64,
        total_amount: u64,
        release_schedule: ReleaseSchedule,
        release_authority: ReleaseAuthority,
        expires_at: Option<i64>,
        arbiter: Option<Pubkey>,
    ) -> Result<()> {
        instructions::create_escrow::handler(
            ctx,
            vault_id,
            total_amount,
            release_schedule,
            release_authority,
            expires_at,
            arbiter,
        )
    }
    pub fn deposit_funds(
        ctx: Context<DepositFunds>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit_funds::handler(ctx, amount)
    }
    pub fn withdraw_available(
        ctx: Context<WithdrawAvailable>,
        max_amount: Option<u64>,
    ) -> Result<()> {
        instructions::withdraw_available::handler(ctx, max_amount)
    }
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        instructions::close::handler(ctx)
    }
    pub fn update_release_schedule(
        ctx: Context<UpdateReleaseSchedule>,
        new_schedule: ReleaseSchedule,
    ) -> Result<()> {
        instructions::update_release_schedule::handler(ctx, new_schedule)
    }
    pub fn release_milestone(
        ctx: Context<ReleaseMilestone>,
        milestone_id: u32,
    ) -> Result<()> {
        instructions::release_milestone::handler(ctx, milestone_id)
    }
}