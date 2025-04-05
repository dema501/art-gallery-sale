# Art Gallery Marketplace (NFT Demo)

⚠️ **DISCLAIMER: This is a demonstration project only. Not intended for production use.**

A smart contract demonstration showing implementation of an NFT marketplace with features like royalties, admin controls, and pausable functionality.

## Overview

This project showcases a basic implementation of an NFT marketplace where artists can list their artwork as NFTs and buyers can purchase them. It includes features commonly found in production NFT marketplaces but is simplified for educational purposes.

### Key Features

- NFT minting and listing
- Artwork sales with royalties
- Admin controls
- Pausable functionality
- Basic security measures
- Comprehensive test coverage

## Technical Stack

- Solidity ^0.8.28
- Hardhat
- OpenZeppelin Contracts
- Viem
- TypeScript

## Smart Contract Architecture
The main contract `ArtGalleryMarketplace.sol` implements:
- ERC721 token standard
- ERC2981 royalty standard
- Ownable access control
- ReentrancyGuard security
- Pausable functionality

## Getting Started

### Prerequisites

- Node.js >= 18.x
- npm or yarn
- Git

### Installation

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile
```

### Deployment

1. Start a local Hardhat node:
```bash
npx hardhat node
```

2. Deploy the contract using Hardhat Ignition:
```bash
# Deploy to localhost
npx hardhat ignition deploy ./ignition/modules/ArtGalleryMarketplace.ts --network localhost

# Deploy to a testnet (e.g., Sepolia)
npx hardhat ignition deploy ./ignition/modules/ArtGalleryMarketplace.ts --network sepolia
```

3. Verify contract deployment:
```bash
# Set the deployed contract address as an environment variable
export CONTRACT_ADDRESS=<deployed-contract-address>

# Check admin status
npx hardhat run scripts/check-admin.ts --network localhost

# For testnets, verify the contract on Etherscan
npx hardhat verify --network sepolia $CONTRACT_ADDRESS
```

### Contract Interaction

1. Check admin status:
```bash
CONTRACT_ADDRESS=<contract-address> npx hardhat run scripts/check-admin.ts --network localhost
```

2. Mint artwork:
```bash
CONTRACT_ADDRESS=<contract-address> ARTIST_ADDRESS=<artist-address> URI=<metadata-uri> npx hardhat run scripts/mint-artwork.ts --network localhost
```

3. List artwork for sale:
```bash
CONTRACT_ADDRESS=<contract-address> TOKEN_ID=<token-id> PRICE=<price-in-wei> npx hardhat run scripts/list-artwork.ts --network localhost
```

## Testing

The project includes a comprehensive test suite covering:
- Contract deployment
- Admin management
- Artwork listing and sales
- Royalty calculations
- Security features
- Edge cases

Run the tests:
```bash
npm test

# Run tests again, this time generating a gas usage report
REPORT_GAS=true npx hardhat test
```

## Environment Variables

Create a `.env` file in the root directory with the following variables:
```env
# Required for deployment
PRIVATE_KEY=your_private_key
INFURA_API_KEY=your_infura_api_key

# Required for Etherscan verification
ETHERSCAN_API_KEY=your_etherscan_api_key

# Optional: For gas reporting
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key
```

## Security Considerations

While this contract implements basic security measures, it is **NOT** production-ready. Additional security measures would be needed, including:

- Professional security audit
- More extensive testing
- Additional access controls
- Emergency functions
- Rate limiting
- Additional validation checks

## Contributing

This is a demonstration project, but suggestions for improvements are welcome:

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT

## Disclaimer

This code is provided as-is for demonstration and educational purposes only. It has not been audited and should not be used in production without significant additional development and security measures.

The authors and contributors are not responsible for any losses or damages that may result from using this code.

## Acknowledgments

- OpenZeppelin for their contracts and security best practices
- Ethereum community for inspiration and guidance
