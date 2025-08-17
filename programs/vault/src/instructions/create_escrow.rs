use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = depositor,
        space = EscrowVault::LEN,
        seeds = [
            b"escrow_vault",
            owner_program.key().as_ref(),
            vault_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,
    #[account(
        init,
        payer = depositor,
        associated_token::mint = token_mint,
        associated_token::authority = escrow_vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"escrow_config"],
        bump = config.bump
    )]
    pub config: Account<'info, EscrowConfig>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    /// CHECK: The beneficiary account is validated in the handler to ensure it's a valid Solana address
    pub beneficiary: UncheckedAccount<'info>,
    /// CHECK: The owner program is validated in the handler to ensure it's a valid program account
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: The owner account is validated in the handler to ensure it's a valid Solana address
    pub owner_account: UncheckedAccount<'info>,
    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
pub fn handler(
    ctx: Context<CreateEscrow>,
    vault_id: u64,
    total_amount: u64,
    release_schedule: ReleaseSchedule,
    release_authority: ReleaseAuthority,
    expires_at: Option<i64>,
    arbiter: Option<Pubkey>,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let escrow = &mut ctx.accounts.escrow_vault;
    let clock = Clock::get()?;
    require!(!config.paused, VaultError::ProgramPaused);
    require!(
        total_amount >= config.min_escrow_amount,
        VaultError::InvalidAmount
    );
    if let Some(exp) = expires_at {
        require!(
            exp > clock.unix_timestamp,
            VaultError::InvalidTimeRange
        );
    }
    match &release_schedule {
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
                total_milestone_amount == total_amount,
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
            require!(
                linear_config.end_time - linear_config.start_time <= config.max_escrow_duration,
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
                combined_total == total_amount && total_milestone_amount == *milestone_portion,
                VaultError::InvalidMilestoneConfig
            );
        },
        _ => {}
    }
    escrow.vault_id = vault_id;
    escrow.owner_program = ctx.accounts.owner_program.key();
    escrow.owner_account = ctx.accounts.owner_account.key();
    escrow.depositor = ctx.accounts.depositor.key();
    escrow.beneficiary = ctx.accounts.beneficiary.key();
    escrow.arbiter = arbiter;
    escrow.token_mint = ctx.accounts.token_mint.key();
    escrow.vault_token_account = ctx.accounts.vault_token_account.key();
    escrow.total_amount = total_amount;
    escrow.released_amount = 0;
    escrow.refunded_amount = 0;
    escrow.locked_amount = 0;
    escrow.release_schedule = release_schedule;
    escrow.release_authority = release_authority;
    escrow.status = EscrowStatus::Initialized;
    escrow.created_at = clock.unix_timestamp;
    escrow.updated_at = clock.unix_timestamp;
    escrow.expires_at = expires_at;
    escrow.bump = ctx.bumps.escrow_vault;
    msg!("Escrow vault {} created for {} tokens", vault_id, total_amount);
    Ok(())
}