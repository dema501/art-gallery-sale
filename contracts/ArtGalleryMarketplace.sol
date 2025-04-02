// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ArtGalleryMarketplace
 * @dev NFT marketplace for art sales and purchases, including royalties and pause functionality
 * @notice Implements ERC721 standard with additional marketplace features
 * @author Original implementation
 */
contract ArtGalleryMarketplace is
    ERC721URIStorage,
    Ownable,
    ReentrancyGuard,
    Pausable,
    IERC2981
{
    using Strings for uint256;

    /// @notice Default royalty fee in basis points (2.5%)
    uint256 public constant DEFAULT_ROYALTY_FEE = 0;

    /// @notice Maximum allowed royalty fee in basis points (50%)
    uint256 public constant MAX_ROYALTY_FEE = 5000;

    /// @notice Current royalty fee in basis points
    uint256 public royaltyFee = DEFAULT_ROYALTY_FEE;

    /// @notice Counter for token IDs
    uint256 private _tokenIdCounter;

    /// @notice Structure containing artwork listing information
    struct ArtworkListing {
        uint256 price; // Price in wei
        bool isForSale; // Whether artwork is currently for sale
        address artist; // Original artist address for royalties
    }

    /// @notice Mapping of token ID to its listing details
    mapping(uint256 => ArtworkListing) private _artworks;

    /// @notice Mapping of addresses to admin status
    mapping(address => bool) private _admins;

    /// @notice Emitted when new artwork is listed
    event ArtworkListed(uint256 indexed tokenId, address artist, uint256 price);

    /// @notice Emitted when artwork is sold
    event ArtworkSold(
        uint256 indexed tokenId,
        address seller,
        address buyer,
        uint256 price
    );

    /// @notice Emitted when artwork price is updated
    event PriceUpdated(uint256 indexed tokenId, uint256 newPrice);

    /// @notice Emitted when admin status changes
    event AdminStatusChanged(address indexed account, bool isAdminStatus);

    /// @notice Emitted when royalty fee is updated
    event RoyaltyFeeUpdated(uint256 newFee);

    /// @notice Custom error for zero or negative price
    error ArtGalleryMarketplace__PriceMustBeAboveZero();
    /// @notice Custom error for artwork not being for sale
    error ArtGalleryMarketplace__NotForSale();
    /// @notice Custom error for insufficient payment
    error ArtGalleryMarketplace__InsufficientPayment();
    /// @notice Custom error for unauthorized access
    error ArtGalleryMarketplace__NotOwner();
    /// @notice Custom error for failed payment transfer
    error ArtGalleryMarketplace__TransferFailed();
    /// @notice Custom error for non-admin access
    error ArtGalleryMarketplace__NotAdmin();
    /// @notice Custom error for invalid royalty fee
    error ArtGalleryMarketplace__InvalidRoyaltyFee();

    modifier onlyAdmin() {
        if (!_admins[msg.sender] && msg.sender != owner())
            revert ArtGalleryMarketplace__NotAdmin();
        _;
    }

    /// @notice Initializes the contract with name and symbol
    constructor() ERC721("ArtGallery NFT Market", "AGNFT") Ownable(msg.sender) {
        _admins[msg.sender] = true;
    }

    /**
     * @notice Updates the royalty fee
     * @dev Only callable by admins. Fee must be > 0 and <= 50%
     * @param newFee New royalty fee in basis points
     */
    function setRoyaltyFee(uint256 newFee) public onlyAdmin whenNotPaused {
        if (newFee < 0 || newFee > MAX_ROYALTY_FEE)
            revert ArtGalleryMarketplace__InvalidRoyaltyFee();
        royaltyFee = newFee;
        emit RoyaltyFeeUpdated(newFee);
    }

    /**
     * @notice Adds or removes an admin
     * @dev Only callable by owner
     * @param account Address to modify admin status for
     * @param isAdminStatus Whether the account should be admin
     */
    function setAdmin(
        address account,
        bool isAdminStatus
    ) public onlyOwner whenNotPaused {
        _admins[account] = isAdminStatus;
        emit AdminStatusChanged(account, isAdminStatus);
    }

    /**
     * @notice Checks if an address is an admin
     * @param account Address to check
     * @return bool Whether the address is an admin
     */
    function isAdmin(address account) public view returns (bool) {
        return _admins[account] || account == owner();
    }

    /**
     * @notice Lists a new artwork for sale
     * @dev Mints new token and creates listing
     * @param tokenURI The metadata URI for the artwork
     * @param price The price in wei
     * @return uint256 The ID of the newly created token
     */
    function listArtwork(
        string memory tokenURI,
        uint256 price
    ) public whenNotPaused returns (uint256) {
        if (price == 0) revert ArtGalleryMarketplace__PriceMustBeAboveZero();

        // Increment counter *before* minting/storage updates
        unchecked {
            _tokenIdCounter++;
        }

        uint256 newTokenId = _tokenIdCounter; // Assign after incrementing

        _mint(msg.sender, newTokenId);
        _setTokenURI(newTokenId, tokenURI);

        _artworks[newTokenId] = ArtworkListing({
            price: price,
            isForSale: true,
            artist: msg.sender
        });

        emit ArtworkListed(newTokenId, msg.sender, price);

        return newTokenId;
    }

    /**
     * @notice Purchases an artwork
     * @dev Handles payment and transfer of NFT
     * @param tokenId The ID of the artwork to purchase
     */
    function buyArtwork(
        uint256 tokenId
    ) public payable nonReentrant whenNotPaused {
        ArtworkListing storage artwork = _artworks[tokenId];
        address seller = ownerOf(tokenId);
        uint256 salePrice = artwork.price;

        if (!artwork.isForSale) revert ArtGalleryMarketplace__NotForSale();
        // Require exact payment
        if (msg.value != salePrice)
            revert ArtGalleryMarketplace__InsufficientPayment();

        artwork.isForSale = false; // Mark as sold *before* transfers
        _transfer(seller, msg.sender, tokenId); // Transfer NFT

        // Calculate and distribute royalties and proceeds
        (address royaltyReceiver, uint256 royaltyAmount) = royaltyInfo(
            tokenId,
            salePrice
        );

        // Ensure royalty amount doesn't exceed sale price (sanity check)
        if (royaltyAmount > salePrice) {
            // This shouldn't happen with standard royaltyFee limits, but good practice
            revert("Calculated royalty exceeds sale price"); // Consider custom error
        }

        uint256 sellerProceeds = salePrice - royaltyAmount;

        // Pay Royalty (if applicable)
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool successRoyalty, ) = payable(royaltyReceiver).call{
                value: royaltyAmount
            }("");
            // Important: Decide how to handle royalty payment failure.
            // Option 1 (Safer): Revert the whole transaction
            if (!successRoyalty) revert ArtGalleryMarketplace__TransferFailed();
            // Option 2 (Complex): Log failure, send royalty to owner/treasury? Requires careful thought. Reverting is usually best.
        }

        // Critical: Transfer payment to seller
        if (sellerProceeds > 0) {
            // Avoid sending 0 value calls
            (bool successSeller, ) = payable(seller).call{
                value: sellerProceeds
            }("");
            if (!successSeller) revert ArtGalleryMarketplace__TransferFailed();
        }

        emit ArtworkSold(tokenId, seller, msg.sender, msg.value);
    }

    /**
     * @notice Updates the price of an artwork
     * @dev Only callable by artwork owner or admin
     * @param tokenId The ID of the artwork
     * @param newPrice The new price in wei
     */
    function updatePrice(
        uint256 tokenId,
        uint256 newPrice
    ) public onlyAdmin whenNotPaused {
        if (ownerOf(tokenId) != msg.sender && !_admins[msg.sender])
            revert ArtGalleryMarketplace__NotOwner();
        if (newPrice <= 0) revert ArtGalleryMarketplace__PriceMustBeAboveZero();

        _artworks[tokenId].price = newPrice;
        _artworks[tokenId].isForSale = true;

        emit PriceUpdated(tokenId, newPrice);
    }

    /**
     * @notice Takes an artwork off the market
     * @dev Only callable by artwork owner or admin
     * @param tokenId The ID of the artwork
     */
    function delistArtwork(uint256 tokenId) public onlyAdmin whenNotPaused {
        if (ownerOf(tokenId) != msg.sender && !_admins[msg.sender])
            revert ArtGalleryMarketplace__NotOwner();

        _artworks[tokenId].isForSale = false;
    }

    /**
     * @notice Gets the details of an artwork
     * @param tokenId The ID of the artwork
     * @return ArtworkListing The artwork listing details
     */
    function getArtwork(
        uint256 tokenId
    ) public view returns (ArtworkListing memory) {
        return _artworks[tokenId];
    }

    /**
     * @notice Checks if an artwork is for sale
     * @param tokenId The ID of the artwork
     * @return bool Whether the artwork is for sale
     */
    function isArtworkForSale(uint256 tokenId) public view returns (bool) {
        return _artworks[tokenId].isForSale;
    }

    /**
     * @notice Gets the current price of an artwork
     * @param tokenId The ID of the artwork
     * @return uint256 The price in wei
     */
    function getPrice(uint256 tokenId) public view returns (uint256) {
        return _artworks[tokenId].price;
    }

    /**
     * @notice Gets the total number of artworks in the market
     * @return uint256 The total number of artworks
     */
    function getTotalArtworks() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @notice Calculates royalty information for a sale
     * @param tokenId The ID of the artwork
     * @param salePrice The sale price to calculate royalty from
     * @return receiver Address to receive royalty
     * @return royaltyAmount Amount of royalty to be paid
     */
    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) public view override returns (address receiver, uint256 royaltyAmount) {
        address artist = _artworks[tokenId].artist;
        if (artist == address(0) || royaltyFee == 0) {
            return (address(0), 0);
        }
        // Calculate royalty based on the current fee.
        return (artist, (salePrice * royaltyFee) / 10000);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * Adds support for ERC2981 interface detection.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, IERC165) returns (bool) {
        // Check if the interfaceId is for IERC2981 OR delegate to the parent implementation
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /**
     * @notice Pauses all token transfers and sales
     * @dev Only callable by contract owner
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses all token transfers and sales
     * @dev Only callable by contract owner
     */
    function unpause() public onlyOwner {
        _unpause();
    }
}
