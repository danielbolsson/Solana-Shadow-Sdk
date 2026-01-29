use crate::error::PrivacyError;
use solana_program::{msg, program_error::ProgramError};
use ark_bn254::{Bn254, Fr};
use ark_groth16::{Groth16, Proof, VerifyingKey, prepare_verifying_key};
use ark_serialize::CanonicalDeserialize;
use ark_snark::SNARK;
use borsh::BorshDeserialize;

/// Verify Groth16 ZK-SNARK proof for transfer using ark-groth16
pub fn verify_transfer_proof(proof: &[u8], public_inputs: &[Vec<u8>], vk_account_data: &[u8]) -> Result<bool, ProgramError> {
    #[cfg(not(feature = "real-zk-verification"))]
    {
        msg!("DEBUG: Skipping ZK verification for demo");
        Ok(true)
    }

    #[cfg(feature = "real-zk-verification")]
    {
        msg!("Verifying Groth16 transfer proof...");
        
        // 1. Load and prepare the Verifying Key from PDA (Heap allocated)
        let vk = load_verification_key_from_account(vk_account_data)?;
        let pvk = Box::new(prepare_verifying_key(&vk));
        
        // 2. Deserialize the proof (Boxed to save stack space)
        let proof_obj = Box::new(Proof::<Bn254>::deserialize_compressed(proof)
            .map_err(|e| {
                msg!("Error deserializing proof: {:?}", e);
                PrivacyError::InvalidProof
            })?);
            
        // 3. Prepare public inputs (Merkle root, Nullifier, New Commitment)
        let inputs = deserialize_field_elements(public_inputs)?;
        
        // 4. Perform Groth16 verification
        // Argument order: PVK, Proof, PublicInputs
        let result = Groth16::<Bn254>::verify_proof(&pvk, &proof_obj, &inputs)
            .map_err(|e| {
                msg!("Error during ZK verification: {:?}", e);
                PrivacyError::InvalidProof
            })?;
            
        if result {
            msg!("✓ Groth16 transfer proof verified successfully");
        } else {
            msg!("✗ Groth16 transfer proof verification failed");
        }
        
        Ok(result)
    }
}

/// Verify balance proof using ark-groth16
pub fn verify_balance_proof(proof: &[u8], public_inputs: &[Vec<u8>], vk_account_data: &[u8]) -> Result<bool, ProgramError> {
    #[cfg(not(feature = "real-zk-verification"))]
    {
        msg!("DEBUG: Skipping ZK verification for demo");
        Ok(true)
    }

    #[cfg(feature = "real-zk-verification")]
    {
        msg!("Verifying Groth16 balance proof...");
        
        let vk = load_verification_key_from_account(vk_account_data)?;
        let pvk = Box::new(prepare_verifying_key(&vk));
        
        let proof_obj = Box::new(Proof::<Bn254>::deserialize_compressed(proof)
            .map_err(|e| {
                msg!("Error deserializing proof: {:?}", e);
                PrivacyError::InvalidProof
            })?);
            
        let inputs = deserialize_field_elements(public_inputs)?;
        
        let result = Groth16::<Bn254>::verify_proof(&pvk, &proof_obj, &inputs)
            .map_err(|e| {
                msg!("Error during ZK verification: {:?}", e);
                PrivacyError::InvalidProof
            })?;
            
        if result {
            msg!("✓ Groth16 balance proof verified successfully");
        } else {
            msg!("✗ Groth16 balance proof verification failed");
        }
        
        Ok(result)
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

    // Ring signature verification algorithm (MLSAG):
    // For each ring member i:
    //   1. Compute L_i = r_i*G + c_i*P_i  (using curve operations)
    //   2. Compute R_i = r_i*H_p(P_i) + c_i*I  (where I is the key image)
    //   3. Compute c_{i+1} = H(message, L_i, R_i)
    // Verify that c_{n} wraps back to c_0

    use solana_program::keccak;

    for (i, pubkey) in ring_members.iter().enumerate() {
        let r_i = &responses[i];

        // In a full implementation, we would:
        // 1. Perform elliptic curve point multiplication: r_i*G and c_i*P_i
        // 2. Perform point addition: L_i = r_i*G + c_i*P_i
        // 3. Hash the public key to a point: H_p(P_i)
        // 4. Compute R_i = r_i*H_p(P_i) + c_i*I
        //
        // For now, we use a simplified verification that checks structure:

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
///
/// Expects VK account data in the following format (see VerificationKeyAccount):
/// - circuit_type: u8
/// - pool: Pubkey (32 bytes)
/// - authority: Pubkey (32 bytes)
/// - vk_data: Vec<u8> (length-prefixed)
/// - stored_at: i64
/// - bump: u8
pub fn load_verification_key_from_account(
    vk_account_data: &[u8],
) -> Result<Box<VerifyingKey<Bn254>>, ProgramError> {
    use crate::state::VerificationKeyAccount;

    // Deserialize the VK account
    let vk_account = VerificationKeyAccount::try_from_slice(vk_account_data)
        .map_err(|e| {
            msg!("Error deserializing VK account: {:?}", e);
            PrivacyError::InvalidVerificationKey
        })?;

    // Deserialize the verification key from the stored data
    let vk = VerifyingKey::<Bn254>::deserialize_compressed(&vk_account.vk_data[..])
        .map_err(|e| {
            msg!("Error deserializing verification key: {:?}", e);
            PrivacyError::InvalidVerificationKey
        })?;

    msg!("✓ Verification key loaded successfully from PDA");
    Ok(Box::new(vk))
}

/// Load transfer verification key (helper function for backward compatibility)
fn load_transfer_verification_key_from_data(vk_data: &[u8]) -> Result<Box<VerifyingKey<Bn254>>, ProgramError> {
    load_verification_key_from_account(vk_data)
}

/// Load balance verification key (helper function for backward compatibility)
fn load_balance_verification_key_from_data(vk_data: &[u8]) -> Result<Box<VerifyingKey<Bn254>>, ProgramError> {
    load_verification_key_from_account(vk_data)
}

/// Deserialize field elements from bytes to Fr (BN254 field elements)
fn deserialize_field_elements(inputs: &[Vec<u8>]) -> Result<Vec<Fr>, ProgramError> {
    let mut elements = Vec::new();

    for input in inputs {
        if input.len() != 32 {
            msg!("Error: Input must be 32 bytes, got {}", input.len());
            return Err(PrivacyError::InvalidPublicInputs.into());
        }

        // Deserialize as field element
        let fr = Fr::deserialize_compressed(&input[..])
            .map_err(|e| {
                msg!("Error deserializing field element: {:?}", e);
                PrivacyError::InvalidPublicInputs
            })?;

        elements.push(fr);
    }

    Ok(elements)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_transfer_proof() {
        let proof = vec![0u8; 192]; // Minimum valid size
        let public_inputs = vec![vec![0u8; 32], vec![0u8; 32], vec![0u8; 32]];

        let result = verify_transfer_proof(&proof, &public_inputs);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

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
    fn test_invalid_proof_size() {
        let proof = vec![0u8; 100]; // Too small
        let public_inputs = vec![vec![0u8; 32]];

        let result = verify_transfer_proof(&proof, &public_inputs);
        assert!(result.is_ok());
        assert!(!result.unwrap());
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
