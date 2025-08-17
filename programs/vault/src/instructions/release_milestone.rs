use anchor_lang::prelude::*;
use crate::state::*;
#[derive(Accounts)]
pub struct ReleaseMilestone<'info> {
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
    pub authority: Signer<'info>,
}
pub fn handler(ctx: Context<ReleaseMilestone>, milestone_id: u32) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_vault;
    let clock = Clock::get()?;
    require!(
        escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::Funded,
        VaultError::InvalidStatus
    );
    let mut found = false;
    let mut already_completed = false;
    match &mut escrow.release_schedule {
        ReleaseSchedule::Milestone { conditions } => {
            for condition in conditions.iter_mut() {
                if condition.milestone_id == milestone_id {
                    found = true;
                    if condition.is_completed {
                        already_completed = true;
                        break;
                    }
                    require!(
                        ctx.accounts.authority.key() == condition.required_approval,
                        VaultError::Unauthorized
                    );
                    condition.is_completed = true;
                    break;
                }
            }
        },
        ReleaseSchedule::Hybrid { milestone_config, .. } => {
            for condition in milestone_config.iter_mut() {
                if condition.milestone_id == milestone_id {
                    found = true;
                    if condition.is_completed {
                        already_completed = true;
                        break;
                    }
                    require!(
                        ctx.accounts.authority.key() == condition.required_approval,
                        VaultError::Unauthorized
                    );
                    condition.is_completed = true;
                    break;
                }
            }
        },
        _ => {
            return Err(VaultError::InvalidMilestoneConfig.into());
        }
    }
    require!(found, VaultError::MilestoneNotFound);
    require!(!already_completed, VaultError::MilestoneAlreadyCompleted);
    escrow.updated_at = clock.unix_timestamp;
    msg!("Milestone {} released for vault {}", milestone_id, escrow.vault_id);
    Ok(())
}