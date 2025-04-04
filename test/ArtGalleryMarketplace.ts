import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  parseEther,
  zeroAddress,
  TransactionReceipt,
  AbiEventNotFoundError,
} from "viem";

// Helper function to parse ArtworkListed event and get tokenId
async function getTokenIdFromReceipt(
  artGallery: any, // Consider typing this more strictly if possible
  receipt: TransactionReceipt,
): Promise<bigint | null> {
  try {
    const events = await artGallery.getEvents.ArtworkListed(
      {}, // No filters needed here, just getting events from the block range
      { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
    );
    // Find the event originating from the specific transaction hash
    const relevantEvent = events.find(
      (e: any) => e.transactionHash === receipt.transactionHash,
    );
    if (relevantEvent?.args?.tokenId !== undefined) {
      return relevantEvent.args.tokenId;
    }
  } catch (error) {
    // Handle cases where the event might not be found or ABI issues
    if (error instanceof AbiEventNotFoundError) {
      console.error("ArtworkListed event ABI not found or mismatch.");
    } else {
      console.error("Error fetching ArtworkListed event:", error);
    }
  }
  console.warn(
    `Could not find ArtworkListed event for tx ${receipt.transactionHash} in block ${receipt.blockNumber}`,
  );
  return null; // Or throw an error if tokenId is essential for the test flow
}

describe("ArtGalleryMarketplace Contract Tests", function () {
  // --- Constants ---
  const TEST_URI_1 = "ipfs://QmTestHash1";
  const TEST_URI_2 = "ipfs://QmTestHash2";
  const ONE_ETHER = parseEther("1");
  const TWO_ETHER = parseEther("2");
  const POINT_FIVE_ETHER = parseEther("0.5");
  const DEFAULT_ROYALTY_FEE = 0n;
  const MAX_ROYALTY_FEE = 5000n; // From contract
  const NON_EXISTENT_TOKEN_ID = 999n;
  const SAMPLE_ROYALTY_FEE_BPS = 500n; // 5%
  const DEFAULT_MAX_PRICE = parseEther("1000");
  // --- Fixtures ---

  /**
   * @notice Deploys the ArtGalleryMarketplace contract and returns standard accounts/clients.
   */
  async function deployMarketplaceFixture() {
    // Get multiple accounts for different roles
    const [
      owner,
      artist1,
      artist2,
      buyer1,
      buyer2,
      designatedAdmin,
      otherAccount,
    ] = await hre.viem.getWalletClients();

    // Deploy the contract using the 'owner' account
    const artGallery = await hre.viem.deployContract(
      "ArtGalleryMarketplace",
      [],
      {
        client: { wallet: owner },
      },
    );
    const publicClient = await hre.viem.getPublicClient();

    return {
      artGallery,
      owner, // Contract deployer & initial admin
      artist1,
      artist2,
      buyer1,
      buyer2,
      designatedAdmin, // An account intended to be made admin later
      otherAccount, // A regular user account
      publicClient,
    };
  }

  /**
   * @notice Deploys the contract and lists one artwork (tokenId 1) by artist1.
   */
  async function listedArtworkFixture() {
    const deployData = await deployMarketplaceFixture();
    const { artGallery, artist1, publicClient } = deployData;

    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    const txHash = await artGalleryAsArtist.write.listArtwork([
      TEST_URI_1,
      ONE_ETHER,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const tokenId = await getTokenIdFromReceipt(artGallery, receipt);

    const events3 = await artGallery.getEvents.ArtworkListed();

    if (tokenId === null) {
      throw new Error(
        "listedArtworkFixture: Failed to retrieve tokenId from ArtworkListed event.",
      );
    }
    // Specific check for fixture setup
    expect(tokenId).to.equal(1n);

    return { ...deployData, tokenId };
  }

  /**
   * @notice Deploys, lists one artwork, and sells it to buyer1.
   */
  async function soldArtworkFixture() {
    const listedData = await listedArtworkFixture();
    const { artGallery, buyer1, publicClient, tokenId } = listedData;

    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    const buyTxHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
      value: ONE_ETHER,
    });
    await publicClient.waitForTransactionReceipt({ hash: buyTxHash });

    return { ...listedData }; // buyer1 is now the owner of tokenId
  }

  /**
   * @notice Deploys the contract and designates an additional admin account.
   */
  async function designatedAdminFixture() {
    const deployData = await deployMarketplaceFixture();
    const { artGallery, owner, designatedAdmin, publicClient } = deployData;
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    const txHash = await artGalleryAsOwner.write.setAdmin([
      getAddress(designatedAdmin.account.address),
      true,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Verify admin was set
    expect(
      await artGallery.read.isAdmin([
        getAddress(designatedAdmin.account.address),
      ]),
    ).to.be.true;

    return deployData; // Contains the designatedAdmin who is now admin
  }

  // --- Test Suites ---

  // ==============================
  // 1. Deployment & Initialization
  // ==============================
  describe("1. Deployment and Initialization", function () {
    it("1.1 should have correct name and symbol", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      expect(await artGallery.read.name()).to.equal("ArtGallery NFT Market");
      expect(await artGallery.read.symbol()).to.equal("AGNFT");
    });

    it("1.2 should set deployer as owner", async function () {
      const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
      expect(await artGallery.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("1.3 should set owner as initial admin and emit AdminStatusChanged event", async function () {
      const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
      const ownerAddress = getAddress(owner.account.address);
      expect(await artGallery.read.isAdmin([ownerAddress])).to.be.true;

      // Check event emitted by constructor
      const events = await artGallery.getEvents.AdminStatusChanged();
      expect(events).to.have.lengthOf(1); // Constructor emits exactly one
      expect(events[0].args.account).to.equal(ownerAddress);
      expect(events[0].args.isAdminStatus).to.be.true;
    });

    it("1.4 should have correct default royalty fee", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      expect(await artGallery.read.royaltyFee()).to.equal(DEFAULT_ROYALTY_FEE);
    });

    it("1.5 should support required interfaces (IERC721, IERC2981)", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      const ierc721InterfaceId = "0x80ac58cd";
      const ierc2981InterfaceId = "0x2a55205a";
      expect(await artGallery.read.supportsInterface([ierc721InterfaceId])).to
        .be.true;
      expect(await artGallery.read.supportsInterface([ierc2981InterfaceId])).to
        .be.true;
    });

    it("1.6 should initialize total artworks count to 0", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      expect(await artGallery.read.getTotalArtworks()).to.equal(0n);
    });
  });

  // ==========================
  // 2. Admin Management
  // ==========================
  describe("2. Admin Management (`setAdmin`)", function () {
    it("2.1 should allow owner to add a new admin", async function () {
      const { artGallery, owner, designatedAdmin, publicClient } =
        await loadFixture(deployMarketplaceFixture);
      const adminAddress = getAddress(designatedAdmin.account.address);
      const ownerAddress = getAddress(owner.account.address);

      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const txHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      expect(await artGallery.read.isAdmin([adminAddress])).to.be.true;

      const events = await artGallery.getEvents.AdminStatusChanged(
        {},
        {
          fromBlock: 0n, // Start from genesis block
          toBlock: receipt.blockNumber,
        },
      );

      expect(events.length).to.have.greaterThanOrEqual(2); // At least constructor + this add
      expect(events[0].args.account).to.equal(ownerAddress);
      expect(events[0].args.isAdminStatus).to.be.true;

      // Check the last event emitted
      expect(events[events.length - 1].args.account).to.equal(adminAddress);
      expect(events[events.length - 1].args.isAdminStatus).to.be.true;
    });

    it("2.2 should allow owner to remove an admin", async function () {
      const { artGallery, owner, designatedAdmin, publicClient } =
        await loadFixture(designatedAdminFixture); // Use fixture where designatedAdmin is already admin
      const adminAddress = getAddress(designatedAdmin.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      expect(await artGallery.read.isAdmin([adminAddress])).to.be.true; // Verify pre-condition

      const removeTxHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        false,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: removeTxHash,
      });
      expect(await artGallery.read.isAdmin([adminAddress])).to.be.false;

      const events = await artGallery.getEvents.AdminStatusChanged(
        {},
        {
          fromBlock: 0n, // Start from genesis block
          toBlock: receipt.blockNumber,
        },
      );
      expect(events.length).to.have.greaterThanOrEqual(2); // At least constructor + add + this remove
      // Check the last event emitted
      expect(events[events.length - 1].args.account).to.equal(adminAddress);
      expect(events[events.length - 1].args.isAdminStatus).to.be.false;
    });

    it("2.3 should NOT allow non-owner (even an admin) to manage admins", async function () {
      const { artGallery, designatedAdmin, otherAccount } = await loadFixture(
        designatedAdminFixture,
      ); // designatedAdmin is admin here
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: designatedAdmin } },
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      // Admin tries to add another admin
      await expect(
        artGalleryAsAdmin.write.setAdmin([
          getAddress(otherAccount.account.address),
          true,
        ]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");

      // Regular user tries to add an admin
      await expect(
        artGalleryAsOther.write.setAdmin([
          getAddress(designatedAdmin.account.address),
          true,
        ]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  // ==========================
  // 3. Royalty Management
  // ==========================
  describe("3. Royalty Management (`setRoyaltyFee`, `royaltyInfo`)", function () {
    it("3.1 should allow any admin to set a valid royalty fee", async function () {
      const { artGallery, owner, designatedAdmin, publicClient } =
        await loadFixture(designatedAdminFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: designatedAdmin } },
      );

      // Owner sets fee
      const fee1 = 500n; // 5%
      const tx1 = await artGalleryAsOwner.write.setRoyaltyFee([fee1]);
      const receipt1 = await publicClient.waitForTransactionReceipt({
        hash: tx1,
      });
      expect(await artGallery.read.royaltyFee()).to.equal(fee1);

      // Designated admin sets fee
      const fee2 = 1000n; // 10%
      const tx2 = await artGalleryAsAdmin.write.setRoyaltyFee([fee2]);
      const receipt2 = await publicClient.waitForTransactionReceipt({
        hash: tx2,
      });
      expect(await artGallery.read.royaltyFee()).to.equal(fee2);

      const events = await artGallery.getEvents.RoyaltyFeeUpdated({
        fromBlock: receipt1.blockNumber,
        toBlock: receipt2.blockNumber,
      });
      expect(events.length).to.have.greaterThanOrEqual(2); // At least these two settings
      expect(events[0].args.newFee).to.equal(fee1); // Check last setting
      expect(events[events.length - 1].args.newFee).to.equal(fee2); // Check last setting
    });

    it("3.2 should NOT allow setting royalty fee above maximum", async function () {
      const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      await expect(
        artGalleryAsOwner.write.setRoyaltyFee([MAX_ROYALTY_FEE + 1n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__InvalidRoyaltyFee");
    });

    it("3.3 should NOT allow non-admin to set royalty fee", async function () {
      const { artGallery, otherAccount } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      await expect(
        artGalleryAsOther.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("3.4 should calculate correct royalty via `royaltyInfo` when fee is set", async function () {
      const { artGallery, owner, artist1, publicClient, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Set royalty fee
      const txHash = await artGalleryAsOwner.write.setRoyaltyFee([
        SAMPLE_ROYALTY_FEE_BPS,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash }); // Ensure confirmed

      const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
        tokenId,
        ONE_ETHER,
      ]);
      const expectedRoyalty = (ONE_ETHER * SAMPLE_ROYALTY_FEE_BPS) / 10000n;

      expect(receiver).to.equal(artistAddress);
      expect(royaltyAmount).to.equal(expectedRoyalty);
    });

    it("3.5 should calculate zero royalty via `royaltyInfo` if fee is zero", async function () {
      const { artGallery, artist1, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address);
      // Fee is 0 by default in fixture

      const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
        tokenId,
        ONE_ETHER,
      ]);

      // Check the contract's royaltyInfo implementation:
      // if (artist == address(0) || royaltyFee == 0) {
      //     return (address(0), 0);
      // }

      // Since royaltyFee is 0, the contract returns address(0) as receiver
      expect(receiver).to.equal(zeroAddress); // Changed from artistAddress
      expect(royaltyAmount).to.equal(0n);
    });

    it("3.6 should calculate zero royalty via `royaltyInfo` for non-existent token", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Set a non-zero fee
      const txHash = await artGalleryAsOwner.write.setRoyaltyFee([
        SAMPLE_ROYALTY_FEE_BPS,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
        NON_EXISTENT_TOKEN_ID,
        ONE_ETHER,
      ]);

      expect(receiver).to.equal(zeroAddress); // Because artist defaults to 0
      expect(royaltyAmount).to.equal(0n); // Because artist is 0
    });
  });

  // ==========================
  // 4. Artwork Listing
  // ==========================
  describe("4. Artwork Listing (`listArtwork`)", function () {
    it("4.1 should allow listing artwork with valid inputs and verify all states", async function () {
      const { artGallery, artist1, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artistAddress = getAddress(artist1.account.address);
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const initialTotalArtworks = await artGallery.read.getTotalArtworks();

      const txHash = await artGalleryAsArtist.write.listArtwork([
        TEST_URI_1,
        ONE_ETHER,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      const tokenId = await getTokenIdFromReceipt(artGallery, receipt);
      expect(tokenId).to.not.be.null;
      expect(tokenId).to.equal(initialTotalArtworks + 1n);

      // Verify all states and events
      const events = await artGallery.getEvents.ArtworkListed(
        {},
        { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
      );
      const eventArgs = events.find((e) => e.args.tokenId === tokenId)?.args;
      expect(eventArgs).to.exist;
      expect(eventArgs?.artist).to.equal(artistAddress);
      expect(eventArgs?.price).to.equal(ONE_ETHER);

      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(artistAddress);
      expect(await artGallery.read.tokenURI([tokenId!])).to.equal(TEST_URI_1);

      const [price, isForSale, originalArtist] =
        await artGallery.read.getArtwork([tokenId!]);
      expect(price).to.equal(ONE_ETHER);
      expect(isForSale).to.be.true;
      expect(originalArtist).to.equal(artistAddress);
      expect(await artGallery.read.getTotalArtworks()).to.equal(
        initialTotalArtworks + 1n,
      );
    });

    it("4.2 should maintain incremental token IDs across different listings", async function () {
      const { artGallery, artist1, artist2, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist1 = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );
      const artGalleryAsArtist2 = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist2 } },
      );

      const tx1 = await artGalleryAsArtist1.write.listArtwork([
        TEST_URI_1,
        ONE_ETHER,
      ]);
      const receipt1 = await publicClient.waitForTransactionReceipt({
        hash: tx1,
      });
      const tokenId1 = await getTokenIdFromReceipt(artGallery, receipt1);
      expect(tokenId1).to.equal(1n);

      const tx2 = await artGalleryAsArtist2.write.listArtwork([
        TEST_URI_2,
        TWO_ETHER,
      ]);
      const receipt2 = await publicClient.waitForTransactionReceipt({
        hash: tx2,
      });
      const tokenId2 = await getTokenIdFromReceipt(artGallery, receipt2);
      expect(tokenId2).to.equal(tokenId1! + 1n);
      expect(await artGallery.read.getTotalArtworks()).to.equal(tokenId2);
    });

    it("4.3 should revert for invalid inputs (zero price, empty URI, price above max)", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const maxPrice = await artGallery.read.maxPrice();

      await expect(
        artGalleryAsArtist.write.listArtwork([TEST_URI_1, 0n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");

      await expect(
        artGalleryAsArtist.write.listArtwork(["", ONE_ETHER]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__EmptyURINotAllowed");

      await expect(
        artGalleryAsArtist.write.listArtwork([TEST_URI_1, maxPrice + 1n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceExceedsMaximum");
    });
  });

  // ==========================
  // 5. Artwork Purchase
  // ==========================
  describe("5. Artwork Purchase (`buyArtwork`)", function () {
    it("5.1 should allow purchasing listed artwork with exact payment", async function () {
      const { artGallery, artist1, buyer1, publicClient, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address);
      const buyerAddress = getAddress(buyer1.account.address);
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      const initialArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      const initialBuyerBalance = await publicClient.getBalance({
        address: buyerAddress,
      });

      const txHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
        value: ONE_ETHER,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      // Verify events
      const events = await artGallery.getEvents.ArtworkSold(
        {},
        { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
      );
      expect(events).to.have.lengthOf(1); // Only one sale happened in this tx
      expect(events[0].args.tokenId).to.equal(tokenId);
      expect(events[0].args.seller).to.equal(artistAddress);
      expect(events[0].args.buyer).to.equal(buyerAddress);
      expect(events[0].args.price).to.equal(ONE_ETHER);

      // Verify state changes
      expect(await artGallery.read.ownerOf([tokenId])).to.equal(buyerAddress);
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

      // Verify balance changes (assuming zero royalty fee)
      const finalArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      const finalBuyerBalance = await publicClient.getBalance({
        address: buyerAddress,
      });
      expect(finalArtistBalance).to.equal(initialArtistBalance + ONE_ETHER);
      expect(finalBuyerBalance).to.equal(
        initialBuyerBalance - ONE_ETHER - gasUsed,
      );
    });

    it("5.2 should distribute funds correctly with non-zero royalty during purchase", async function () {
      const { artGallery, owner, artist1, buyer1, publicClient, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address); // Original artist AND initial seller
      const buyerAddress = getAddress(buyer1.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      // Set royalty fee
      const royaltyFeeBps = 1000n; // 10%
      const royaltyTx = await artGalleryAsOwner.write.setRoyaltyFee([
        royaltyFeeBps,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: royaltyTx });

      const initialArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      const initialBuyerBalance = await publicClient.getBalance({
        address: buyerAddress,
      });

      const salePrice = ONE_ETHER;
      const expectedRoyalty = (salePrice * royaltyFeeBps) / 10000n;
      const expectedSellerProceeds = salePrice - expectedRoyalty;

      // Buyer purchases
      const buyTxHash = await artGalleryAsBuyer.write.buyArtwork([tokenId], {
        value: salePrice,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: buyTxHash,
      });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      // Verify balance changes
      const finalArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      const finalBuyerBalance = await publicClient.getBalance({
        address: buyerAddress,
      });

      // In this specific case, the Artist is also the Seller, so they receive both portions.
      expect(finalArtistBalance).to.equal(
        initialArtistBalance + expectedSellerProceeds + expectedRoyalty,
      );

      expect(finalBuyerBalance).to.equal(
        initialBuyerBalance - salePrice - gasUsed,
      );
    });

    it("5.3 should revert purchase if payment is not exact (insufficient or excessive)", async function () {
      const { artGallery, buyer1, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      // Insufficient
      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId], {
          value: POINT_FIVE_ETHER,
        }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__ExactPaymentRequired");

      // Excessive
      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId], { value: TWO_ETHER }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__ExactPaymentRequired");
    });

    it("5.4 should revert purchase for non-existent artwork", async function () {
      const { artGallery, buyer1 } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      await expect(
        artGalleryAsBuyer.write.buyArtwork([NON_EXISTENT_TOKEN_ID], {
          value: ONE_ETHER,
        }),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check
    });

    it("5.5 should revert purchase for artwork not for sale (sold or delisted)", async function () {
      const soldData = await loadFixture(soldArtworkFixture); // Artwork sold to buyer1
      const { artGallery, owner, buyer2, publicClient, tokenId } = soldData;
      const artGalleryAsBuyer2 = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer2 } },
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Attempt to buy already sold artwork
      await expect(
        artGalleryAsBuyer2.write.buyArtwork([tokenId], { value: ONE_ETHER }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");

      // Delist the already sold artwork (admin action) - this should succeed but is just for setup
      const delistTx = await artGalleryAsOwner.write.delistArtwork([tokenId]);
      await publicClient.waitForTransactionReceipt({ hash: delistTx });
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

      // Attempt to buy delisted artwork
      await expect(
        artGalleryAsBuyer2.write.buyArtwork([tokenId], { value: ONE_ETHER }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");
    });
  });

  // ==========================
  // 6. Price Update (Admin Only)
  // ==========================
  describe("6. Price Update (`updatePrice`) - Admin Only", function () {
    it("6.1 should allow any admin to update price and relist if needed", async function () {
      // First, deploy and set up admin
      const deployData = await loadFixture(deployMarketplaceFixture);
      const { artGallery, owner, designatedAdmin, publicClient } = deployData;

      // Make designatedAdmin an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      await artGalleryAsOwner.write.setAdmin([
        getAddress(designatedAdmin.account.address),
        true,
      ]);

      // List an artwork first (as owner)
      const listTx = await artGalleryAsOwner.write.listArtwork([
        TEST_URI_1,
        ONE_ETHER,
      ]);
      const listReceipt = await publicClient.waitForTransactionReceipt({
        hash: listTx,
      });
      const tokenId = await getTokenIdFromReceipt(artGallery, listReceipt);

      if (!tokenId) {
        throw new Error("Failed to get tokenId from listing");
      }

      const artGalleryAsDesignatedAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: designatedAdmin } },
      );

      // Owner updates price
      const tx1 = await artGalleryAsOwner.write.updatePrice([
        tokenId,
        TWO_ETHER,
      ]);

      const receipt1 = await publicClient.waitForTransactionReceipt({
        hash: tx1,
      });

      const [price1, isForSale1] = await artGallery.read.getArtwork([tokenId]);
      expect(price1).to.equal(TWO_ETHER);
      expect(isForSale1).to.be.true;

      // Designated admin updates price
      const tx2 = await artGalleryAsDesignatedAdmin.write.updatePrice([
        tokenId,
        POINT_FIVE_ETHER,
      ]);
      const receipt2 = await publicClient.waitForTransactionReceipt({
        hash: tx2,
      });

      const [price2, isForSale2] = await artGallery.read.getArtwork([tokenId]);
      expect(price2).to.equal(POINT_FIVE_ETHER);
      expect(isForSale2).to.be.true;

      // Check events
      const events = await artGallery.getEvents.PriceUpdated(
        {},
        { fromBlock: receipt1.blockNumber, toBlock: receipt2.blockNumber },
      );

      expect(events.length).to.be.greaterThanOrEqual(2);
      expect(events[events.length - 2].args.tokenId).to.equal(tokenId);
      expect(events[events.length - 2].args.newPrice).to.equal(TWO_ETHER);
      expect(events[events.length - 1].args.tokenId).to.equal(tokenId);
      expect(events[events.length - 1].args.newPrice).to.equal(
        POINT_FIVE_ETHER,
      );
    });

    it("6.2 should NOT allow non-admin (including token owner) to update price", async function () {
      const { artGallery, artist1, otherAccount, tokenId } =
        await loadFixture(listedArtworkFixture); // artist1 owns token
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      // Token owner attempts update
      await expect(
        artGalleryAsArtist.write.updatePrice([tokenId, TWO_ETHER]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin"); // Expect NotAdmin (since onlyAdmin modifier is used)

      // Other account attempts update
      await expect(
        artGalleryAsOther.write.updatePrice([tokenId, TWO_ETHER]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("6.3 should revert updatePrice if price is zero", async function () {
      const { artGallery, owner, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      await expect(
        artGalleryAsOwner.write.updatePrice([tokenId, 0n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");
    });

    it("6.4 should revert updatePrice for non-existent artwork", async function () {
      const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      await expect(
        artGalleryAsOwner.write.updatePrice([NON_EXISTENT_TOKEN_ID, ONE_ETHER]),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check first
    });
  });

  // ============================
  // 7. Delisting (Admin Only)
  // ============================
  describe("7. Delisting (`delistArtwork`) - Admin Only", function () {
    it("7.1 should allow any admin to delist artwork", async function () {
      // First deploy and set up initial state
      const { artGallery, owner, designatedAdmin, publicClient } =
        await loadFixture(deployMarketplaceFixture);

      // Make designatedAdmin an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Set up admin
      await artGalleryAsOwner.write.setAdmin([
        getAddress(designatedAdmin.account.address),
        true,
      ]);

      // List an artwork first
      const listTx = await artGalleryAsOwner.write.listArtwork([
        TEST_URI_1,
        ONE_ETHER,
      ]);
      const listReceipt = await publicClient.waitForTransactionReceipt({
        hash: listTx,
      });

      const tokenId = await getTokenIdFromReceipt(artGallery, listReceipt);

      if (!tokenId) {
        throw new Error("Failed to get tokenId from listing");
      }

      const artGalleryAsDesignatedAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: designatedAdmin } },
      );

      // Verify artwork is initially for sale
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true;

      // Owner delists
      const tx1 = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      const receipt1 = await publicClient.waitForTransactionReceipt({
        hash: tx1,
      });
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;

      // Relist it by updating price
      await artGalleryAsOwner.write.updatePrice([tokenId, ONE_ETHER]);
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.true;

      // Designated admin delists
      const tx2 = await artGalleryAsDesignatedAdmin.write.delistArtwork([
        tokenId,
      ]);

      const receipt2 = await publicClient.waitForTransactionReceipt({
        hash: tx2,
      });
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

      // Check second delist event
      const events = await artGallery.getEvents.ArtworkDelisted(
        {},
        { fromBlock: receipt1.blockNumber, toBlock: receipt2.blockNumber },
      );
      expect(events.length).to.be.greaterThanOrEqual(2);
      expect(events[0].args.tokenId).to.equal(tokenId);
      expect(events[0].blockNumber).to.equal(receipt1.blockNumber);

      expect(events[events.length - 1].args.tokenId).to.equal(tokenId);
      expect(events[events.length - 1].blockNumber).to.equal(
        receipt2.blockNumber,
      );
    });

    it("7.2 should NOT allow non-admin (including token owner) to delist artwork", async function () {
      const { artGallery, artist1, otherAccount, tokenId } =
        await loadFixture(listedArtworkFixture); // artist1 owns token
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      // Token owner attempts delist
      await expect(
        artGalleryAsArtist.write.delistArtwork([tokenId]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");

      // Other account attempts delist
      await expect(
        artGalleryAsOther.write.delistArtwork([tokenId]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("7.3 should revert delisting non-existent artwork", async function () {
      const { artGallery, owner } = await loadFixture(deployMarketplaceFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      await expect(
        artGalleryAsOwner.write.delistArtwork([NON_EXISTENT_TOKEN_ID]),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts at ownerOf check
    });

    it("7.4 should succeed but have no effect when admin delists already delisted artwork", async function () {
      const { artGallery, owner, publicClient, tokenId } =
        await loadFixture(listedArtworkFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Delist first time
      const tx1 = await artGalleryAsOwner.write.delistArtwork([tokenId]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;

      // Delist second time - should not revert
      await expect(artGalleryAsOwner.write.delistArtwork([tokenId])).to.not.be
        .rejected;

      // State remains unchanged
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false;
    });
  });

  // ==========================
  // 8. Pause Functionality
  // ==========================
  describe("8. Pause Functionality (`pause`, `unpause`)", function () {
    it("8.1 should allow owner to pause and unpause", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });
      expect(await artGallery.read.paused()).to.be.true;

      // Unpause
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });
      expect(await artGallery.read.paused()).to.be.false;
    });

    it("8.2 should NOT allow non-owner to pause or unpause", async function () {
      const { artGallery, designatedAdmin, otherAccount } = await loadFixture(
        designatedAdminFixture,
      ); // Use fixture where designatedAdmin is admin but not owner
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: designatedAdmin } },
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      // Admin tries
      await expect(artGalleryAsAdmin.write.pause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );
      await expect(artGalleryAsAdmin.write.unpause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );

      // Other user tries
      await expect(artGalleryAsOther.write.pause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );
      await expect(artGalleryAsOther.write.unpause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );
    });

    it("8.3 should prevent state-changing actions when paused", async function () {
      const {
        artGallery,
        owner,
        artist1,
        designatedAdmin,
        buyer1,
        publicClient,
        tokenId,
      } = await loadFixture(listedArtworkFixture).then(
        async (listedData) => ({
          ...listedData,
          ...(await loadFixture(designatedAdminFixture)),
        }), // Combine fixtures
      );

      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      // Pause the contract
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });
      expect(await artGallery.read.paused()).to.be.true;

      // Test actions affected by whenNotPaused
      await expect(
        artGalleryAsArtist.write.listArtwork([TEST_URI_2, ONE_ETHER]),
      ).to.be.rejectedWith("EnforcedPause()");
      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId], { value: ONE_ETHER }),
      ).to.be.rejectedWith("EnforcedPause()");
      await expect(
        artGalleryAsOwner.write.updatePrice([tokenId, TWO_ETHER]),
      ).to.be.rejectedWith("EnforcedPause()");
      await expect(
        artGalleryAsOwner.write.delistArtwork([tokenId]),
      ).to.be.rejectedWith("EnforcedPause()");
      await expect(
        artGalleryAsOwner.write.setAdmin([
          getAddress(designatedAdmin.account.address),
          true,
        ]),
      ).to.be.rejectedWith("EnforcedPause()");
      await expect(
        artGalleryAsOwner.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
      ).to.be.rejectedWith("EnforcedPause()");

      // Unpause and verify one action works again
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });
      expect(await artGallery.read.paused()).to.be.false;

      // Example: setRoyaltyFee should work now
      await expect(
        artGalleryAsOwner.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
      ).to.not.be.rejected;
    });
  });

  // ==============================
  // 9. View Functions & Edge Cases
  // ==============================
  describe("9. View Functions and Edge Cases", function () {
    it("9.1 `getArtwork` should return correct details for existing listed/sold artwork", async function () {
      const listedData = await loadFixture(listedArtworkFixture);
      const soldData = await loadFixture(soldArtworkFixture);
      const {
        artGallery: artGalleryListed,
        artist1: artist1Listed,
        tokenId: tokenIdListed,
      } = listedData;
      const {
        artGallery: artGallerySold,
        artist1: artist1Sold,
        buyer1: buyer1Sold,
        tokenId: tokenIdSold,
      } = soldData;

      // Check listed artwork
      const [priceListed, isForSaleListed, artistListed] =
        await artGalleryListed.read.getArtwork([tokenIdListed]);
      expect(priceListed).to.equal(ONE_ETHER);
      expect(isForSaleListed).to.be.true;
      expect(artistListed).to.equal(getAddress(artist1Listed.account.address));

      // Check sold artwork
      const [priceSold, isForSaleSold, artistSold] =
        await artGallerySold.read.getArtwork([tokenIdSold]);
      expect(priceSold).to.equal(ONE_ETHER); // Price remains after sale
      expect(isForSaleSold).to.be.false; // Not for sale
      expect(artistSold).to.equal(getAddress(artist1Sold.account.address)); // Original artist
      expect(await artGallerySold.read.ownerOf([tokenIdSold])).to.equal(
        getAddress(buyer1Sold.account.address),
      ); // Current owner changed
    });

    it("9.2 `getArtwork` should revert for non-existent token", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      await expect(
        artGallery.read.getArtwork([NON_EXISTENT_TOKEN_ID]),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts due to internal ownerOf check
    });

    it("9.3 `isArtworkForSale` should return correct status (true/false) for existing tokens", async function () {
      const { artGallery, owner, publicClient, tokenId } =
        await loadFixture(listedArtworkFixture);
      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.true; // Initially true

      // Delist it
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const tx = await artGalleryAsOwner.write.delistArtwork([tokenId]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false; // False after delist
    });

    it("9.4 `isArtworkForSale` should return false for non-existent token", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      // Does not revert, returns default mapping value (false)
      expect(await artGallery.read.isArtworkForSale([NON_EXISTENT_TOKEN_ID])).to
        .be.false;
    });

    it("9.5 `getPrice` should return correct price for existing tokens", async function () {
      const { artGallery, tokenId } = await loadFixture(listedArtworkFixture);
      expect(await artGallery.read.getPrice([tokenId])).to.equal(ONE_ETHER);
    });

    it("9.6 `getPrice` should return zero for non-existent token", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      // Does not revert, returns default mapping value (0)
      expect(await artGallery.read.getPrice([NON_EXISTENT_TOKEN_ID])).to.equal(
        0n,
      );
    });

    it("9.7 `getTotalArtworks` should reflect the number of minted tokens", async function () {
      const { artGallery, artist1, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      expect(await artGallery.read.getTotalArtworks()).to.equal(0n);

      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      // List first
      const tx1 = await artGalleryAsArtist.write.listArtwork([
        TEST_URI_1,
        ONE_ETHER,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      expect(await artGallery.read.getTotalArtworks()).to.equal(1n);

      // List second
      const tx2 = await artGalleryAsArtist.write.listArtwork([
        TEST_URI_2,
        ONE_ETHER,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx2 });
      expect(await artGallery.read.getTotalArtworks()).to.equal(2n);
    });

    it("9.8 `tokenURI` should return correct URI for existing token", async function () {
      const { artGallery, tokenId } = await loadFixture(listedArtworkFixture);
      expect(await artGallery.read.tokenURI([tokenId])).to.equal(TEST_URI_1);
    });

    it("9.9 `tokenURI` should revert for non-existent token", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      await expect(
        artGallery.read.tokenURI([NON_EXISTENT_TOKEN_ID]),
      ).to.be.rejectedWith("ERC721NonexistentToken");
    });
  });

  describe("10. MaxPrice Management", function () {
    it("10.1 should initialize with correct default max price", async function () {
      const { artGallery } = await loadFixture(deployMarketplaceFixture);
      expect(await artGallery.read.maxPrice()).to.equal(parseEther("1000"));
    });

    it("10.2 should allow admin to update max price", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const newMaxPrice = parseEther("2000");
      const tx = await artGalleryAsOwner.write.setMaxPrice([newMaxPrice]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      expect(await artGallery.read.maxPrice()).to.equal(newMaxPrice);

      const events = await artGallery.getEvents.MaxPriceUpdated();
      expect(events[events.length - 1].args.newMaxPrice).to.equal(newMaxPrice);
    });

    it("10.3 should NOT allow non-admin to update max price", async function () {
      const { artGallery, otherAccount } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsOther = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: otherAccount } },
      );

      await expect(
        artGalleryAsOther.write.setMaxPrice([parseEther("2000")]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });
  });

  describe("11. Batch Listing Operations", function () {
    const TEST_URI_3 = "ipfs://QmTestHash3";

    it("11.1 should allow batch listing of multiple artworks", async function () {
      const { artGallery, artist1, publicClient } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const uris = [TEST_URI_1, TEST_URI_2, TEST_URI_3];
      const prices = [ONE_ETHER, TWO_ETHER, POINT_FIVE_ETHER];

      const tx = await artGalleryAsArtist.write.batchListArtworks([
        uris,
        prices,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      const events = await artGallery.getEvents.BatchArtworksListed({
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });

      expect(events.length).to.equal(1);
      expect(events[0].args.tokenIds?.length).to.equal(3);

      // Verify each artwork
      for (let i = 0; i < uris.length; i++) {
        const tokenId = events[0].args.tokenIds?.[i];
        const [price, isForSale, artist] = await artGallery.read.getArtwork([
          tokenId!,
        ]);
        expect(price).to.equal(prices[i]);
        expect(isForSale).to.be.true;
        expect(artist).to.equal(getAddress(artist1.account.address));
        expect(await artGallery.read.tokenURI([tokenId!])).to.equal(uris[i]);
      }
    });

    it("11.2 should revert batch listing with mismatched arrays", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(
        artGalleryAsArtist.write.batchListArtworks([
          [TEST_URI_1, TEST_URI_2],
          [ONE_ETHER],
        ]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__ArrayLengthMismatch");
    });

    it("11.3 should revert batch listing with empty arrays", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(
        artGalleryAsArtist.write.batchListArtworks([[], []]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__EmptyArraysNotAllowed");
    });

    it("11.4 should revert batch listing if any price exceeds max price", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const maxPrice = await artGallery.read.maxPrice();
      await expect(
        artGalleryAsArtist.write.batchListArtworks([
          [TEST_URI_1],
          [maxPrice + 1n],
        ]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceExceedsMaximum");
    });
  });
}); // End of outer describe block
