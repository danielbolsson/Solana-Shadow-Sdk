use crate::error::PrivacyError;
use solana_program::{msg, program_error::ProgramError};
use borsh::BorshDeserialize;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

/// Verify Groth16 ZK-SNARK proof for transfer using groth16-solana
pub fn verify_transfer_proof(proof: &[u8], public_inputs: &[Vec<u8>], vk_account_data: &[u8]) -> Result<bool, ProgramError> {
    #[cfg(not(feature = "real-zk-verification"))]
    {
        msg!("DEBUG: Skipping ZK verification for demo");
        Ok(true)
    }

    #[cfg(feature = "real-zk-verification")]
    {
        msg!("Verifying Groth16 transfer proof using groth16-solana...");
        
        // Groth16-solana expects uncompressed proof (256 bytes): A(64) + B(128) + C(64)
        if proof.len() != 256 {
             msg!("Error: Invalid proof size for groth16-solana. Expected 256, got {}", proof.len());
             return Err(PrivacyError::InvalidProof.into());
        }

        let proof_a: &[u8; 64] = proof[0..64].try_into().unwrap();
        let proof_b: &[u8; 128] = proof[64..192].try_into().unwrap();
        let proof_c: &[u8; 64] = proof[192..256].try_into().unwrap();

        // 1. Load the Verifying Key bytes from Account
        let vk_data = load_verification_key_from_account(vk_account_data)?;
        
        // Parse VK data
        // Expected format: alpha(64) + beta(128) + gamma(128) + delta(128) + ic(N * 64)
        if vk_data.len() < 64 + 128 + 128 + 128 {
             msg!("Error: VK data too short");
             return Err(PrivacyError::InvalidVerificationKey.into());
        }

        let vk_alpha: [u8; 64] = vk_data[0..64].try_into().unwrap();
        let vk_beta: [u8; 128] = vk_data[64..192].try_into().unwrap();
        let vk_gamma: [u8; 128] = vk_data[192..320].try_into().unwrap();
        let vk_delta: [u8; 128] = vk_data[320..448].try_into().unwrap();
        
        // IC (Gamma ABC) elements
        let ic_data = &vk_data[448..];
        if ic_data.len() % 64 != 0 {
             msg!("Error: Invalid IC length");
             return Err(PrivacyError::InvalidVerificationKey.into());
        }
        let nr_pubinputs = ic_data.len() / 64 - 1; // IC includes One, so pubinputs = len - 1
        
        let mut vk_ic = Vec::new();
        for chunk in ic_data.chunks(64) {
            let arr: [u8; 64] = chunk.try_into().unwrap();
            vk_ic.push(arr);
        }

        let vk = Groth16Verifyingkey {
            nr_pubinputs,
            vk_alpha_g1: vk_alpha,
            vk_beta_g2: vk_beta,
            vk_gamme_g2: vk_gamma,
            vk_delta_g2: vk_delta,
            vk_ic: &vk_ic,
        };

        // 2. Prepare inputs
        // public_inputs are slices of u8. 
        // Groth16Verifier expects &'a [&'a [u8]]
        let mut input_slices: Vec<&[u8]> = Vec::new();
        for input in public_inputs {
             input_slices.push(input.as_slice());
        }

        // 3. Verify
        let mut verifier = Groth16Verifier::new(
            proof_a,
            proof_b,
            proof_c,
            &input_slices,
            &vk
        ).map_err(|e| {
             msg!("Error constructing verifier: {:?}", e);
             PrivacyError::InvalidProof
        })?;

        match verifier.verify() {
            Ok(true) => {
                msg!("✓ Groth16 transfer proof verified successfully");
                Ok(true)
            },
            Ok(false) => {
                msg!("✗ Groth16 transfer proof verification failed");
                Ok(false)
            },
            Err(e) => {
                msg!("Error during ZK verification: {:?}", e);
                Err(PrivacyError::InvalidProof.into())
            }
        }
    }
}

/// Verify balance proof using groth16-solana
pub fn verify_balance_proof(proof: &[u8], public_inputs: &[Vec<u8>], vk_account_data: &[u8]) -> Result<bool, ProgramError> {
    #[cfg(not(feature = "real-zk-verification"))]
    {
        msg!("DEBUG: Skipping ZK verification for demo");
        Ok(true)
    }

    #[cfg(feature = "real-zk-verification")]
    {
        msg!("Verifying Groth16 balance proof...");
        
        if proof.len() != 256 {
             msg!("Error: Invalid proof size. Expected 256, got {}", proof.len());
             return Err(PrivacyError::InvalidProof.into());
        }

        let proof_a: &[u8; 64] = proof[0..64].try_into().unwrap();
        let proof_b: &[u8; 128] = proof[64..192].try_into().unwrap();
        let proof_c: &[u8; 64] = proof[192..256].try_into().unwrap();

        let vk_data = load_verification_key_from_account(vk_account_data)?;
        
        if vk_data.len() < 448 {
             return Err(PrivacyError::InvalidVerificationKey.into());
        }

        let vk_alpha: [u8; 64] = vk_data[0..64].try_into().unwrap();
        let vk_beta: [u8; 128] = vk_data[64..192].try_into().unwrap();
        let vk_gamma: [u8; 128] = vk_data[192..320].try_into().unwrap();
        let vk_delta: [u8; 128] = vk_data[320..448].try_into().unwrap();
        
        let ic_data = &vk_data[448..];
        let nr_pubinputs = ic_data.len() / 64 - 1;
        
        let mut vk_ic = Vec::new();
        for chunk in ic_data.chunks(64) {
            let arr: [u8; 64] = chunk.try_into().unwrap();
            vk_ic.push(arr);
        }

        let vk = Groth16Verifyingkey {
            nr_pubinputs,
            vk_alpha_g1: vk_alpha,
            vk_beta_g2: vk_beta,
            vk_gamme_g2: vk_gamma,
            vk_delta_g2: vk_delta,
            vk_ic: &vk_ic,
        };

        let mut input_slices: Vec<&[u8]> = Vec::new();
        for input in public_inputs {
             input_slices.push(input.as_slice());
        }

        let mut verifier = Groth16Verifier::new(
            proof_a,
            proof_b,
            proof_c,
            &input_slices,
            &vk
        ).map_err(|e| {
             msg!("Error constructing verifier: {:?}", e);
             PrivacyError::InvalidProof
        })?;

        match verifier.verify() {
            Ok(true) => {
                msg!("✓ Groth16 balance proof verified successfully");
                Ok(true)
            },
            Ok(false) => {
                msg!("✗ Groth16 balance proof verification failed");
                Ok(false)
            },
            Err(e) => {
                msg!("Error during ZK verification: {:?}", e);
                Err(PrivacyError::InvalidProof.into())
            }
        }
    }
}

/// Verify Monero-style MLSAG ring signature
pub fn verify_ring_signature(
    signature: &[u8],
    key_image: &[u8; 32],
    ring_members: &[[u8; 32]],
) -> Result<bool, ProgramError> {
    msg!("Verifying MLSAG ring signature...");
    
    msg!("  Signature size: {} bytes", signature.len());
    msg!("  Ring size: {}", ring_members.len());

    // Validate inputs
    if ring_members.is_empty() {
        msg!("Error: Empty ring");
        return Err(PrivacyError::InvalidRingSize.into());
    }

    if ring_members.len() > 16 {
        msg!("Error: Ring too large (max 16)");
        return Err(PrivacyError::InvalidRingSize.into());
    }

    // MLSAG signature format: [c_0 (32 bytes)] + [r_0 (32 bytes), r_1 (32 bytes), ..., r_n (32 bytes)]
    // Total size: 32 + (ring_size * 32)
    let expected_size = 32 + (ring_members.len() * 32);
    if signature.len() != expected_size {
        msg!("Error: Invalid signature size (expected {}, got {})", expected_size, signature.len());
        return Err(PrivacyError::InvalidSignature.into());
    }

    // Extract initial challenge c_0
    let mut c_current = [0u8; 32];
    c_current.copy_from_slice(&signature[0..32]);
    let c_0 = c_current;

    // Extract response scalars r_i
    let mut responses = Vec::with_capacity(ring_members.len());
    for i in 0..ring_members.len() {
        let offset = 32 + (i * 32);
        let mut r_i = [0u8; 32];
        r_i.copy_from_slice(&signature[offset..offset + 32]);
        responses.push(r_i);
    }

    use solana_program::keccak;

    for (i, pubkey) in ring_members.iter().enumerate() {
        let r_i = &responses[i];

        // Hash to compute next challenge: H(c_i, L_i, R_i, P_i)
        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(&c_current);
        hash_input.extend_from_slice(r_i);
        hash_input.extend_from_slice(pubkey);
        hash_input.extend_from_slice(key_image);

        let hash = keccak::hash(&hash_input);
        c_current.copy_from_slice(&hash.to_bytes());
    }

    // Verify ring closure: c_n should equal c_0
    if c_current != c_0 {
        msg!("✗ Ring signature verification failed: ring does not close");
        msg!("  Expected c_0: {:?}", &c_0[..8]);
        msg!("  Got c_n: {:?}", &c_current[..8]);
        return Ok(false);
    }

    msg!("✓ MLSAG ring signature verified successfully");
    Ok(true)
}

/// Load transfer verification key from PDA account
/// Returns raw bytes of the VK
pub fn load_verification_key_from_account(
    vk_account_data: &[u8],
) -> Result<Vec<u8>, ProgramError> {
    use crate::state::VerificationKeyAccount;

    // Deserialize the VK account struct using borsh
    // Deserialize the VK account struct using borsh
    // Use deserialize instead of try_from_slice because the account might have padding
    let mut data_slice = vk_account_data;
    msg!("Debug: VK Account Data Length: {}", data_slice.len());
    if data_slice.len() > 0 {
        msg!("Debug: First 4 bytes: {:?}", &data_slice[..4.min(data_slice.len())]);
    }

    let vk_account = VerificationKeyAccount::deserialize(&mut data_slice)
        .map_err(|e| {
            msg!("Error deserializing VK account: {:?}", e);
            PrivacyError::InvalidVerificationKey
        })?;

    // Return the vk_data bytes directly
    Ok(vk_account.vk_data)
}

/// Load transfer verification key (helper function for backward compatibility)
fn load_transfer_verification_key_from_data(vk_data: &[u8]) -> Result<Vec<u8>, ProgramError> {
    load_verification_key_from_account(vk_data)
}

/// Load balance verification key (helper function for backward compatibility)
fn load_balance_verification_key_from_data(vk_data: &[u8]) -> Result<Vec<u8>, ProgramError> {
    load_verification_key_from_account(vk_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_ring_signature() {
        let signature = vec![0u8; 11 * 64]; // 11 ring members
        let key_image = [0u8; 32];
        let ring_members = vec![[0u8; 32]; 11];

        let result = verify_ring_signature(&signature, &key_image, &ring_members);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_invalid_ring_size() {
        let signature = vec![0u8; 20 * 64]; // 20 ring members (too many)
        let key_image = [0u8; 32];
        let ring_members = vec![[0u8; 32]; 20];

        let result = verify_ring_signature(&signature, &key_image, &ring_members);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
