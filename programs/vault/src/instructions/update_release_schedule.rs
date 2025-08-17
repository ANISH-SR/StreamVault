use anchor_lang::prelude::*;
use crate::state::*;
#[derive(Accounts)]
pub struct UpdateReleaseSchedule<'info> {
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
        constraint = authority.key() == escrow_vault.depositor || 
                    (escrow_vault.arbiter.is_some() && 
                     authority.key() == escrow_vault.arbiter.unwrap()) 
                    @ VaultError::Unauthorized
    )]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"escrow_config"],
        bump = config.bump
    )]
    pub config: Account<'info, EscrowConfig>,
}
pub fn handler(
    ctx: Context<UpdateReleaseSchedule>,
    new_schedule: ReleaseSchedule,
) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_vault;
    let config = &ctx.accounts.config;
    let clock = Clock::get()?;
    require!(!config.paused, VaultError::ProgramPaused);
    require!(
        escrow.status == EscrowStatus::Active || 
        escrow.status == EscrowStatus::Funded ||
        escrow.status == EscrowStatus::Paused,
        VaultError::InvalidStatus
    );
    match &new_schedule {
        ReleaseSchedule::Linear { start, end } => {
            require!(
                start < end,
                VaultError::InvalidTimeRange
            );
            require!(
                *end - *start <= config.max_escrow_duration,
                VaultError::InvalidTimeRange
            );
        },
        ReleaseSchedule::Milestone { conditions } => {
            let mut total_milestone_amount = 0u64;
            for condition in conditions {
                total_milestone_amount = total_milestone_amount
                    .checked_add(condition.amount)
                    .ok_or(VaultError::ArithmeticOverflow)?;
            }
            require!(
                total_milestone_amount == escrow.total_amount,
                VaultError::InvalidMilestoneConfig
            );
        },
        ReleaseSchedule::Hybrid { 
            linear_portion, 
            milestone_portion, 
            linear_config,
            milestone_config 
        } => {
            require!(
                linear_config.start_time < linear_config.end_time,
                VaultError::InvalidTimeRange
            );
            let mut total_milestone_amount = 0u64;
            for condition in milestone_config {
                total_milestone_amount = total_milestone_amount
                    .checked_add(condition.amount)
                    .ok_or(VaultError::ArithmeticOverflow)?;
            }
            let combined_total = linear_portion
                .checked_add(*milestone_portion)
                .ok_or(VaultError::ArithmeticOverflow)?;
            require!(
                combined_total == escrow.total_amount && 
                total_milestone_amount == *milestone_portion,
                VaultError::InvalidMilestoneConfig
            );
        },
        _ => {}
    }
    escrow.release_schedule = new_schedule;
    escrow.updated_at = clock.unix_timestamp;
    msg!("Release schedule updated for vault {}", escrow.vault_id);
    Ok(())
}