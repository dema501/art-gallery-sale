// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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

    // --- Constants ---
    uint256 public constant DEFAULT_ROYALTY_FEE = 0;
    uint256 public constant MAX_ROYALTY_FEE = 5000; // 50%
    uint256 public constant DEFAULT_MAX_PRICE = 1000 ether;

    // --- State Variables ---
    uint256 public royaltyFee = DEFAULT_ROYALTY_FEE;
    uint256 public maxPrice = DEFAULT_MAX_PRICE;
    uint256 private _tokenIdCounter;
    mapping(uint256 => ArtworkListing) private _artworks;
    mapping(address => bool) private _admins;

    // --- Structs ---
    struct ArtworkListing {
        uint256 price; // Price in wei
        bool isForSale; // Whether artwork is currently for sale
        address artist; // Original artist address for royalties
    }

    // --- Events ---
    event ArtworkListed(
        uint256 indexed tokenId,
        address indexed artist,
        uint256 price
    );
    event ArtworkSold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );
    event PriceUpdated(uint256 indexed tokenId, uint256 newPrice);
    event AdminStatusChanged(address indexed account, bool isAdminStatus);
    event ArtworkDelisted(uint256 indexed tokenId);
    event RoyaltyFeeUpdated(uint256 newFee);
    event MaxPriceUpdated(uint256 newMaxPrice);
    event BatchArtworksListed(uint256[] tokenIds);

    // --- Custom Errors ---
    error ArtGalleryMarketplace__PriceMustBeAboveZero();
    error ArtGalleryMarketplace__NotForSale();
    error ArtGalleryMarketplace__ExactPaymentRequired();
    error ArtGalleryMarketplace__TransferFailed();
    error ArtGalleryMarketplace__NotAdmin();
    error ArtGalleryMarketplace__InvalidRoyaltyFee();
    error ArtGalleryMarketplace__RoyaltyExceedsPrice();
    error ArtGalleryMarketplace__EmptyURINotAllowed();
    error ArtGalleryMarketplace__PriceExceedsMaximum();
    error ArtGalleryMarketplace__ArrayLengthMismatch();
    error ArtGalleryMarketplace__EmptyArraysNotAllowed();

    // --- Modifiers ---
    /**
     * @dev Throws if caller is not the contract owner or an admin.
     */
    modifier onlyAdmin() {
        if (!isAdmin(msg.sender)) revert ArtGalleryMarketplace__NotAdmin();
        _;
    }

    // --- Constructor ---
    constructor() ERC721("ArtGallery NFT Market", "AGNFT") Ownable(msg.sender) {
        _admins[msg.sender] = true; // Grant admin status to deployer/owner
        emit AdminStatusChanged(msg.sender, true); // Emit event for constructor admin add
    }

    // --- Admin Functions ---

    /**
     * @notice Updates the royalty fee.
     * @dev Only callable by admins. Fee must be >= 0 and <= MAX_ROYALTY_FEE.
     * Requires contract not paused.
     * @param newFee New royalty fee in basis points.
     */
    function setRoyaltyFee(uint256 newFee) public onlyAdmin whenNotPaused {
        if (newFee > MAX_ROYALTY_FEE) {
            revert ArtGalleryMarketplace__InvalidRoyaltyFee();
        }
        royaltyFee = newFee;
        emit RoyaltyFeeUpdated(newFee);
    }

    /**
     * @notice Updates the maximum allowed price for artworks.
     * @dev Only callable by admins. Requires contract not paused.
     * @param newMaxPrice New maximum price in wei.
     */
    function setMaxPrice(uint256 newMaxPrice) public onlyAdmin whenNotPaused {
        maxPrice = newMaxPrice;
        emit MaxPriceUpdated(newMaxPrice);
    }

    /**
     * @notice Adds or removes an admin.
     * @dev Only callable by owner. Requires contract not paused.
     * @param account Address to modify admin status for.
     * @param isAdminStatus Whether the account should be admin.
     */
    function setAdmin(
        address account,
        bool isAdminStatus
    ) public onlyOwner whenNotPaused {
        _admins[account] = isAdminStatus;
        emit AdminStatusChanged(account, isAdminStatus);
    }

    /**
     * @notice Checks if an address is an admin or the contract owner.
     * @param account Address to check.
     * @return bool Whether the address is an admin or owner.
     */
    function isAdmin(address account) public view returns (bool) {
        return _admins[account] || account == owner();
    }

    // --- Marketplace Functions ---

    /**
     * @notice Lists multiple artworks for sale in a single transaction.
     * @dev Mints multiple tokens and creates listings. Requires contract not paused.
     * @param tokenURIs Array of metadata URIs for the artworks.
     * @param prices Array of prices in wei (must all be > 0 and <= maxPrice).
     * @return uint256[] Array of newly created token IDs.
     */
    function batchListArtworks(
        string[] memory tokenURIs,
        uint256[] memory prices
    ) public whenNotPaused returns (uint256[] memory) {
        if (tokenURIs.length != prices.length)
            revert ArtGalleryMarketplace__ArrayLengthMismatch();
        if (tokenURIs.length == 0)
            revert ArtGalleryMarketplace__EmptyArraysNotAllowed();

        uint256[] memory tokenIds = new uint256[](tokenURIs.length);

        for (uint256 i = 0; i < tokenURIs.length; i++) {
            tokenIds[i] = listArtwork(tokenURIs[i], prices[i]);
        }

        emit BatchArtworksListed(tokenIds);
        return tokenIds;
    }

    /**
     * @notice Lists a new artwork for sale.
     * @dev Mints new token and creates listing. Requires contract not paused.
     * @param tokenURI The metadata URI for the artwork.
     * @param price The price in wei (must be > 0 and <= maxPrice).
     * @return uint256 The ID of the newly created token.
     */
    function listArtwork(
        string memory tokenURI,
        uint256 price
    ) public whenNotPaused returns (uint256) {
        if (price == 0) revert ArtGalleryMarketplace__PriceMustBeAboveZero();
        if (price > maxPrice)
            revert ArtGalleryMarketplace__PriceExceedsMaximum();

        if (bytes(tokenURI).length == 0)
            revert ArtGalleryMarketplace__EmptyURINotAllowed();

        uint256 newTokenId;
        unchecked {
            _tokenIdCounter++;
            newTokenId = _tokenIdCounter;
        }

        _mint(msg.sender, newTokenId);
        _setTokenURI(newTokenId, tokenURI);

        _artworks[newTokenId] = ArtworkListing({
            price: price,
            isForSale: true,
            artist: msg.sender // Original minter is the artist
        });

        emit ArtworkListed(newTokenId, msg.sender, price);
        return newTokenId;
    }

    /**
     * @notice Purchases an artwork.
     * @dev Handles payment (exact amount required) and transfer of NFT including royalty distribution.
     * Requires contract not paused. Uses Reentrancy Guard.
     * @param tokenId The ID of the artwork to purchase.
     */
    function buyArtwork(
        uint256 tokenId
    ) public payable nonReentrant whenNotPaused {
        ArtworkListing storage artwork = _artworks[tokenId];
        // ownerOf reverts if token doesn't exist
        address seller = ownerOf(tokenId);
        uint256 salePrice = artwork.price;

        // --- Checks ---
        if (!artwork.isForSale) revert ArtGalleryMarketplace__NotForSale();
        if (msg.value != salePrice)
            revert ArtGalleryMarketplace__ExactPaymentRequired();

        // --- Effects ---
        artwork.isForSale = false; // Mark as sold *before* transfers

        (address royaltyReceiver, uint256 royaltyAmount) = royaltyInfo(
            tokenId,
            salePrice
        );
        if (royaltyAmount > salePrice)
            revert ArtGalleryMarketplace__RoyaltyExceedsPrice();
        uint256 sellerProceeds = salePrice - royaltyAmount;

        // Transfer NFT *before* value transfers but *after* effects on artwork struct
        _transfer(seller, msg.sender, tokenId);

        // --- Interactions ---
        // Pay Royalty
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool successRoyalty, ) = payable(royaltyReceiver).call{
                value: royaltyAmount
            }("");
            if (!successRoyalty) revert ArtGalleryMarketplace__TransferFailed();
        }
        // Pay Seller
        if (sellerProceeds > 0) {
            (bool successSeller, ) = payable(seller).call{
                value: sellerProceeds
            }("");
            if (!successSeller) revert ArtGalleryMarketplace__TransferFailed();
        }

        emit ArtworkSold(tokenId, seller, msg.sender, salePrice);
    }

    /**
     * @notice Updates the price of a listed artwork. Re-lists if not currently for sale.
     * @dev Only callable by an admin. Price must be greater than 0.
     * Requires contract not paused.
     * @param tokenId The ID of the artwork (must exist).
     * @param newPrice The new price in wei.
     */
    function updatePrice(
        uint256 tokenId,
        uint256 newPrice
    ) public onlyAdmin whenNotPaused {
        // Ensure token exists before proceeding
        ownerOf(tokenId); // Reverts if token doesn't exist

        if (newPrice == 0) revert ArtGalleryMarketplace__PriceMustBeAboveZero();
        if (newPrice > maxPrice)
            revert ArtGalleryMarketplace__PriceExceedsMaximum();

        ArtworkListing storage artwork = _artworks[tokenId];
        artwork.price = newPrice;
        artwork.isForSale = true; // Ensure it's marked for sale when price is updated

        emit PriceUpdated(tokenId, newPrice);
    }

    /**
     * @notice Takes an artwork off the market (sets isForSale to false).
     * @dev Only callable by an admin. Requires contract not paused.
     * @param tokenId The ID of the artwork to delist (must exist).
     */
    function delistArtwork(uint256 tokenId) public onlyAdmin whenNotPaused {
        // Ensure token exists before proceeding
        ownerOf(tokenId); // Reverts if token doesn't exist

        _artworks[tokenId].isForSale = false;
        emit ArtworkDelisted(tokenId);
    }

    // --- View Functions ---

    /**
     * @notice Gets the listing details of an artwork.
     * @dev Reverts if the token ID does not exist.
     * @param tokenId The ID of the artwork.
     * @return price The current listed price.
     * @return isForSale Whether the artwork is currently listed for sale.
     * @return artist The original artist address (for royalty purposes).
     */
    function getArtwork(
        uint256 tokenId
    ) public view returns (uint256 price, bool isForSale, address artist) {
        // Checks existence implicitly
        ownerOf(tokenId); // Reverts if token doesn't exist
        ArtworkListing storage artwork = _artworks[tokenId];
        return (artwork.price, artwork.isForSale, artwork.artist);
    }

    /**
     * @notice Checks if an artwork is currently listed for sale.
     * @dev Does NOT revert for non-existent tokens; returns false instead.
     * @param tokenId The ID of the artwork.
     * @return bool Whether the artwork is for sale.
     */
    function isArtworkForSale(uint256 tokenId) public view returns (bool) {
        // If token doesn't exist, mapping returns default struct where isForSale is false.
        return _artworks[tokenId].isForSale;
    }

    /**
     * @notice Gets the current listed price of an artwork.
     * @dev Does NOT revert for non-existent tokens; returns 0 instead.
     * @param tokenId The ID of the artwork.
     * @return uint256 The price in wei.
     */
    function getPrice(uint256 tokenId) public view returns (uint256) {
        // If token doesn't exist, mapping returns default struct where price is 0.
        return _artworks[tokenId].price;
    }

    /**
     * @notice Gets the total number of artworks ever minted by this contract.
     * @return uint256 The total number of artworks.
     */
    function getTotalArtworks() public view returns (uint256) {
        return _tokenIdCounter;
    }

    // --- ERC2981 Royalty Standard ---

    /**
     * @notice Calculates royalty information for a sale price as per ERC2981.
     * @param tokenId The ID of the artwork.
     * @param salePrice The sale price to calculate royalty from.
     * @return receiver Address designated to receive royalty (the original artist).
     * @return royaltyAmount Amount of royalty to be paid based on current royaltyFee.
     */
    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) public view override returns (address receiver, uint256 royaltyAmount) {
        // Mapping read is safe for non-existent IDs (artist defaults to address(0))
        address artist = _artworks[tokenId].artist;

        if (artist == address(0) || royaltyFee == 0) {
            return (address(0), 0);
        }

        royaltyAmount = (salePrice * royaltyFee) / 10000; // Basis points calculation
        return (artist, royaltyAmount);
    }

    /**
     * @dev See {IERC165-supportsInterface}. Adds support for ERC2981.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, IERC165) returns (bool) {
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // --- Pausable Control ---

    /**
     * @notice Pauses all state-changing marketplace operations and transfers.
     * @dev Only callable by contract owner. See {Pausable-_pause}.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses all state-changing marketplace operations and transfers.
     * @dev Only callable by contract owner. See {Pausable-_unpause}.
     */
    function unpause() public onlyOwner {
        _unpause();
    }
}
