import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress, TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

describe("ArtGalleryMarketplace", function () {
  // --- Fixtures ---

  async function deployArtGalleryMarketplaceFixture() {
    const [owner, artist1, artist2, buyer1, buyer2, admin] =
      await hre.viem.getWalletClients();
    const artGallery = await hre.viem.deployContract("ArtGalleryMarketplace");
    const publicClient = await hre.viem.getPublicClient();

    const testURI = "ipfs://QmTest";
    const oneEther = parseEther("1");
    const twoEther = parseEther("2");
    const pointFiveEther = parseEther("0.5");
    const defaultRoyaltyFee = 0n; // 0%

    return {
      artGallery,
      owner,
      artist1,
      artist2,
      buyer1,
      buyer2,
      admin,
      publicClient,
      testURI,
      oneEther,
      twoEther,
      pointFiveEther,
      defaultRoyaltyFee,
    };
  }

  async function createListedArtworkFixture() {
    const deployFixture = await deployArtGalleryMarketplaceFixture();
    const { artGallery, artist1, testURI, oneEther, publicClient } =
      deployFixture;

    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    // Estimate gas for listing
    const gasEstimate = await artGalleryAsArtist.estimateGas.listArtwork([
      testURI,
      oneEther,
    ]);

    // List artwork
    const txHash = await artGalleryAsArtist.write.listArtwork(
      [testURI, oneEther],
      { gas: gasEstimate + 10000n },
    ); // Add buffer

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    if (!receipt.status || receipt.status !== "success") {
      throw new Error(`Transaction failed: ${txHash}`);
    }

    // Find the ArtworkListed event to get the tokenId
    const events = await artGallery.getEvents.ArtworkListed(
      {},
      { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
    );
    expect(events).to.have.lengthOf.at.least(1);
    const tokenId = events[events.length - 1].args.tokenId; // Get the last listed token ID
    expect(tokenId!).to.be.eq(1n);

    return { ...deployFixture, tokenId };
  }

  async function createSoldArtworkFixture() {
    const listedFixture = await createListedArtworkFixture();
    const { artGallery, buyer1, oneEther, publicClient, tokenId } =
      listedFixture;

    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    const buyTxHash = await artGalleryAsBuyer.write.buyArtwork([tokenId!], {
      value: oneEther,
    });
    await publicClient.waitForTransactionReceipt({ hash: buyTxHash });

    return { ...listedFixture, firstBuyer: buyer1 };
  }

  // --- Tests ---

  describe("Deployment & Initialization", function () {
    it("should deploy with correct name and symbol", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      expect(await artGallery.read.name()).to.equal("ArtGallery NFT Market");
      expect(await artGallery.read.symbol()).to.equal("AGNFT");
    });

    it("should set deployer as owner", async function () {
      const { artGallery, owner } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      expect(await artGallery.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("should set owner as initial admin", async function () {
      const { artGallery, owner } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      expect(await artGallery.read.isAdmin([getAddress(owner.account.address)]))
        .to.be.true;
    });

    it("should set correct default royalty fee", async function () {
      const { artGallery, defaultRoyaltyFee } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      expect(await artGallery.read.royaltyFee()).to.equal(defaultRoyaltyFee);
    });

    it("should support IERC721 and IERC2981 interfaces", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const ierc721InterfaceId = "0x80ac58cd";
      const ierc2981InterfaceId = "0x2a55205a";
      expect(await artGallery.read.supportsInterface([ierc721InterfaceId])).to
        .be.true;
      expect(await artGallery.read.supportsInterface([ierc2981InterfaceId])).to
        .be.true;
    });

    it("should initialize total artworks to 0", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      expect(await artGallery.read.getTotalArtworks()).to.equal(0n);
    });
  });

  describe("Admin Management", function () {
    it("should allow owner to add an admin", async function () {
      const { artGallery, owner, admin, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const adminAddress = getAddress(admin.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const txHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      expect(await artGallery.read.isAdmin([adminAddress])).to.be.true;

      const events = await artGallery.getEvents.AdminStatusChanged();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.account).to.equal(adminAddress);
      expect(events[0].args.isAdminStatus).to.be.true;
    });

    it("should allow owner to remove an admin", async function () {
      const { artGallery, owner, admin, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const adminAddress = getAddress(admin.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Add admin first
      const addTxHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: addTxHash });
      expect(await artGallery.read.isAdmin([adminAddress])).to.be.true;

      // Remove admin
      const removeTxHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        false,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: removeTxHash });
      expect(await artGallery.read.isAdmin([adminAddress])).to.be.false;

      // Check events (should have 2 now: add and remove)
      const events = await artGallery.getEvents.AdminStatusChanged();

      // last event Should have isAdminStatus == false
      expect(events.length).to.have.greaterThanOrEqual(1);
      expect(events[events.length - 1].args.account).to.equal(adminAddress); // Check the second event
      expect(events[events.length - 1].args.isAdminStatus).to.be.false;
    });

    it("should not allow non-owner to set admin", async function () {
      const { artGallery, admin, artist1 } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(
        artGalleryAsArtist.write.setAdmin([
          getAddress(admin.account.address),
          true,
        ]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("should not allow admin to set another admin", async function () {
      const { artGallery, owner, admin, artist1, publicClient } =
        await loadFixture(deployArtGalleryMarketplaceFixture);
      const adminAddress = getAddress(admin.account.address);
      const artistAddress = getAddress(artist1.account.address);

      // Owner makes 'admin' an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const txHash = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // 'admin' tries to make 'artist1' an admin
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: admin } },
      );

      await expect(
        artGalleryAsAdmin.write.setAdmin([artistAddress, true]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("should allow owner to remove themselves as admin (but they remain owner)", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const ownerAddress = getAddress(owner.account.address);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Owner is admin by default
      expect(await artGallery.read.isAdmin([ownerAddress])).to.be.true;

      const removeTxHash = await artGalleryAsOwner.write.setAdmin([
        ownerAddress,
        false,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: removeTxHash });

      // Check _admins mapping explicitly (isAdmin checks owner() too)
      // This requires adding an internal getter or relying on events/state checks
      // Let's check the event instead
      const events = await artGallery.getEvents.AdminStatusChanged();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.account).to.equal(ownerAddress);
      expect(events[0].args.isAdminStatus).to.be.false;

      // Even if removed from _admins, isAdmin should return true due to owner check
      expect(await artGallery.read.isAdmin([ownerAddress])).to.be.true;
      // Ensure they are still owner
      expect(await artGallery.read.owner()).to.equal(ownerAddress);
    });
  });

  describe("Royalty Management", function () {
    it("should allow admin (owner) to set royalty fee", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const newFee = 500n; // 5%

      const txHash = await artGalleryAsOwner.write.setRoyaltyFee([newFee]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      expect(await artGallery.read.royaltyFee()).to.equal(newFee);

      const events = await artGallery.getEvents.RoyaltyFeeUpdated();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.newFee).to.equal(newFee);
    });

    it("should allow a designated admin (non-owner) to set royalty fee", async function () {
      const { artGallery, owner, admin, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const adminAddress = getAddress(admin.account.address);
      const newFee = 600n; // 6%

      // Owner makes 'admin' an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const addAdminTx = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: addAdminTx });

      // Admin sets the fee
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: admin } },
      );
      const setFeeTx = await artGalleryAsAdmin.write.setRoyaltyFee([newFee]);
      await publicClient.waitForTransactionReceipt({ hash: setFeeTx });

      expect(await artGallery.read.royaltyFee()).to.equal(newFee);
      const events = await artGallery.getEvents.RoyaltyFeeUpdated();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.newFee).to.equal(newFee);
    });

    it("should not allow setting royalty fee above maximum", async function () {
      const { artGallery, owner } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const maxFee = await artGallery.read.MAX_ROYALTY_FEE(); // 5000n

      await expect(
        artGalleryAsOwner.write.setRoyaltyFee([maxFee + 1n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__InvalidRoyaltyFee");
    });

    it("should not allow non-admin to set royalty fee", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );
      const newFee = 500n;

      await expect(
        artGalleryAsArtist.write.setRoyaltyFee([newFee]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("should calculate royalties correctly via royaltyInfo", async function () {
      const {
        owner,
        publicClient,
        artGallery,
        artist1,
        oneEther,
        defaultRoyaltyFee,
      } = await loadFixture(createListedArtworkFixture); // Use fixture where artwork exists

      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const royaltyFee = 500n;
      // Set low royalty fee to 5%, default 0
      const royaltyTx = await artGalleryAsOwner.write.setRoyaltyFee([
        royaltyFee,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: royaltyTx });

      const artistAddress = getAddress(artist1.account.address);
      const salePrice = oneEther;

      // Need tokenId from the listed fixture
      const listedArtwork = await artGallery.read.getArtwork([1n]);

      // For tokenId 1, which was listed by artist1
      const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
        1n,
        salePrice,
      ]);

      const expectedRoyalty = (salePrice * royaltyFee) / 10000n;

      expect(receiver).to.equal(listedArtwork.artist); // Should be the original artist
      expect(royaltyAmount).to.equal(expectedRoyalty);
    });

    it("should return zero royalties for non-existent token ID in royaltyInfo", async function () {
      const { artGallery, oneEther, defaultRoyaltyFee } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const nonExistentTokenId = 999n;
      const salePrice = oneEther;

      // The behavior for non-existent tokens might vary. Often, they revert or return zero.
      // Checking the implementation: it reads from _artworks[tokenId].artist which will be zeroAddress.
      const [receiver, royaltyAmount] = await artGallery.read.royaltyInfo([
        nonExistentTokenId,
        salePrice,
      ]);

      // Calculation with 0 artist results in 0 (or default royalty if fee applies globally)
      // Let's refine the expectation based on the calculation: (salePrice * royaltyFee) / 10000
      // Since receiver is zeroAddress, the royalty *should* conceptually be zero.
      // The formula doesn't depend on the receiver address directly, only the stored artist.
      // Let's assume the intent is zero royalty if the token/artist isn't found.
      // If the contract intended a different behavior (like reverting), this test would fail.
      expect(receiver).to.equal(zeroAddress); // Default address for non-existent mapping
      expect(royaltyAmount).to.equal(0n);
    });
  });

  describe("Artwork Listing (`listArtwork`)", function () {
    it("should allow an artist to list an artwork", async function () {
      const { artGallery, artist1, testURI, oneEther, publicClient } =
        await loadFixture(deployArtGalleryMarketplaceFixture);
      const artistAddress = getAddress(artist1.account.address);
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const initialTotalArtworks = await artGallery.read.getTotalArtworks();

      const txHash = await artGalleryAsArtist.write.listArtwork([
        testURI,
        oneEther,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      const events = await artGallery.getEvents.ArtworkListed(
        {},
        { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
      );
      expect(events).to.have.lengthOf(1);
      const tokenId = events[0].args.tokenId;
      expect(tokenId).to.equal(initialTotalArtworks + 1n); // Check counter increment

      expect(events[0].args.artist).to.equal(artistAddress);
      expect(events[0].args.price).to.equal(oneEther);

      // Verify state
      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(artistAddress);
      expect(await artGallery.read.tokenURI([tokenId!])).to.equal(testURI);
      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.price).to.equal(oneEther);
      expect(artwork.isForSale).to.be.true;
      expect(artwork.artist).to.equal(artistAddress); // Original artist for royalty
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true;
      expect(await artGallery.read.getTotalArtworks()).to.equal(
        initialTotalArtworks + 1n,
      );
    });

    it("should revert listing with zero price", async function () {
      const { artGallery, artist1, testURI } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(
        artGalleryAsArtist.write.listArtwork([testURI, 0n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");
    });

    it("should assign incremental token IDs", async function () {
      const { artGallery, artist1, artist2, testURI, oneEther, publicClient } =
        await loadFixture(deployArtGalleryMarketplaceFixture);

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

      // List first artwork
      const tx1 = await artGalleryAsArtist1.write.listArtwork([
        testURI + "1",
        oneEther,
      ]);
      const receipt1 = await publicClient.waitForTransactionReceipt({
        hash: tx1,
      });
      const events1 = await artGallery.getEvents.ArtworkListed(
        {},
        { fromBlock: receipt1.blockNumber, toBlock: receipt1.blockNumber },
      );
      const tokenId1 = events1[0].args.tokenId;
      expect(tokenId1).to.equal(1n); // Assuming counter starts implicitly at 0

      // List second artwork
      const tx2 = await artGalleryAsArtist2.write.listArtwork([
        testURI + "2",
        oneEther,
      ]);
      const receipt2 = await publicClient.waitForTransactionReceipt({
        hash: tx2,
      });
      const events2 = await artGallery.getEvents.ArtworkListed(
        {},
        { fromBlock: receipt2.blockNumber, toBlock: receipt2.blockNumber },
      );
      const tokenId2 = events2[0].args.tokenId;

      expect(tokenId2).to.equal(tokenId1! + 1n); // Should be incremental
      expect(await artGallery.read.getTotalArtworks()).to.equal(tokenId2); // Total artworks should match the last ID
    });
  });

  describe("Artwork Purchase (`buyArtwork`)", function () {
    it("should allow a buyer to purchase a listed artwork", async function () {
      const {
        artGallery,
        artist1,
        buyer1,
        oneEther,
        publicClient,
        tokenId, // Get tokenId from the fixture
      } = await loadFixture(createListedArtworkFixture);
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

      const txHash = await artGalleryAsBuyer.write.buyArtwork([tokenId!], {
        value: oneEther,
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
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.tokenId).to.equal(tokenId);
      expect(events[0].args.seller).to.equal(artistAddress); // Seller is the owner at time of sale
      expect(events[0].args.buyer).to.equal(buyerAddress);
      expect(events[0].args.price).to.equal(oneEther);

      // Verify state changes
      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(buyerAddress);
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;
      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.isForSale).to.be.false;

      // Verify balance changes
      const finalArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      const finalBuyerBalance = await publicClient.getBalance({
        address: buyerAddress,
      });

      // Seller (artist in this case) should receive the full price
      // NOTE: This assumes NO royalty payout logic in buyArtwork. If royalties were paid, this check would fail.
      expect(finalArtistBalance).to.equal(initialArtistBalance + oneEther);

      // Buyer's balance should decrease by price + gas fees
      expect(finalBuyerBalance).to.equal(
        initialBuyerBalance - oneEther - gasUsed,
      );
    });

    it("should revert if payment is insufficient", async function () {
      const { artGallery, buyer1, pointFiveEther, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId!], {
          value: pointFiveEther,
        }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__InsufficientPayment");
    });

    it("should revert when trying to buy non-existent artwork", async function () {
      const { artGallery, buyer1, oneEther } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );
      const nonExistentTokenId = 999n;

      // Buying non-existent token usually reverts at ownerOf check
      await expect(
        artGalleryAsBuyer.write.buyArtwork([nonExistentTokenId], {
          value: oneEther,
        }),
      ).to.be.rejectedWith("ERC721NonexistentToken");
    });

    it("should revert when trying to buy artwork that is not for sale (already sold)", async function () {
      const { artGallery, buyer2, oneEther, tokenId } = await loadFixture(
        createSoldArtworkFixture, // Use fixture where token is already sold to buyer1
      );
      const artGalleryAsBuyer2 = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer2 } },
      );

      await expect(
        artGalleryAsBuyer2.write.buyArtwork([tokenId!], { value: oneEther }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");
    });

    it("should revert when trying to buy artwork that is not for sale (delisted)", async function () {
      const { artGallery, owner, buyer1, oneEther, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture);

      // Admin (owner) delists the artwork
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const delistTx = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: delistTx });
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;

      // Buyer tries to buy the delisted artwork
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId!], { value: oneEther }),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotForSale");
    });

    it("should allow owner to buy their own listed artwork (and get funds back)", async function () {
      // This scenario might seem odd, but it should technically work.
      const {
        artGallery,
        artist1, // The lister/owner
        oneEther,
        publicClient,
        tokenId,
      } = await loadFixture(createListedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address);

      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      const initialArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });

      // Artist buys their own artwork
      const txHash = await artGalleryAsArtist.write.buyArtwork([tokenId!], {
        value: oneEther,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      // Verify state
      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(artistAddress); // Ownership doesn't change
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false; // Marked as not for sale

      // Verify balance change (should decrease only by gas cost)
      const finalArtistBalance = await publicClient.getBalance({
        address: artistAddress,
      });
      // Artist pays `oneEther` and immediately receives `oneEther` back.
      expect(finalArtistBalance).to.equal(initialArtistBalance - gasUsed);

      // Verify event
      const events = await artGallery.getEvents.ArtworkSold(
        {},
        { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber },
      );
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.tokenId).to.equal(tokenId);
      expect(events[0].args.seller).to.equal(artistAddress);
      expect(events[0].args.buyer).to.equal(artistAddress);
      expect(events[0].args.price).to.equal(oneEther);
    });
  });

  describe("Price Update (`updatePrice`)", function () {
    // Note: Current implementation uses onlyAdmin modifier

    it("should allow admin (owner) to update the price", async function () {
      const { artGallery, owner, twoEther, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const txHash = await artGalleryAsOwner.write.updatePrice([
        tokenId!,
        twoEther,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.price).to.equal(twoEther);
      expect(artwork.isForSale).to.be.true; // Should ensure it's marked for sale

      const events = await artGallery.getEvents.PriceUpdated();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.tokenId).to.equal(tokenId);
      expect(events[0].args.newPrice).to.equal(twoEther);
    });

    it("should allow a designated admin (non-owner) to update the price", async function () {
      const { artGallery, owner, admin, twoEther, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture);
      const adminAddress = getAddress(admin.account.address);

      // Owner makes 'admin' an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const addAdminTx = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: addAdminTx });

      // Admin updates the price
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: admin } },
      );
      const updatePriceTx = await artGalleryAsAdmin.write.updatePrice([
        tokenId!,
        twoEther,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: updatePriceTx });

      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.price).to.equal(twoEther);
      expect(artwork.isForSale).to.be.true;
    });

    it("should not allow the artwork owner (if not admin) to update price", async function () {
      const { artGallery, artist1, twoEther, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      // artist1 owns the token but is not an admin by default
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      // Fails because updatePrice has onlyAdmin modifier
      await expect(
        artGalleryAsArtist.write.updatePrice([tokenId!, twoEther]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("should not allow non-admin/non-owner to update price", async function () {
      const { artGallery, buyer1, twoEther, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      await expect(
        artGalleryAsBuyer.write.updatePrice([tokenId!, twoEther]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("should revert updating price to zero", async function () {
      const { artGallery, owner, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      await expect(
        artGalleryAsOwner.write.updatePrice([tokenId!, 0n]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__PriceMustBeAboveZero");
    });

    it("should revert updating price for non-existent artwork", async function () {
      const { artGallery, owner, oneEther } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const nonExistentTokenId = 999n;

      // Reverts likely due to ownerOf check inside updatePrice modifier/logic
      await expect(
        artGalleryAsOwner.write.updatePrice([nonExistentTokenId, oneEther]),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // ownerOf check fails first
    });

    it("should relist the artwork if price is updated after being sold/delisted", async function () {
      const { artGallery, owner, twoEther, publicClient, tokenId, firstBuyer } =
        await loadFixture(createSoldArtworkFixture); // Artwork is sold

      // Admin updates the price
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      const txHash = await artGalleryAsOwner.write.updatePrice([
        tokenId!,
        twoEther,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Verify it's for sale again
      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.price).to.equal(twoEther);
      expect(artwork.isForSale).to.be.true; // Should be marked for sale again
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true;

      // Verify owner is still the first buyer
      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(
        getAddress(firstBuyer.account.address),
      );
    });
  });

  describe("Delisting (`delistArtwork`)", function () {
    // Note: Current implementation uses onlyAdmin modifier

    it("should allow admin (owner) to delist artwork", async function () {
      const { artGallery, owner, publicClient, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true; // Pre-condition

      const txHash = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;
      const artwork = await artGallery.read.getArtwork([tokenId!]);
      expect(artwork.isForSale).to.be.false;
      // Add event check if Delist event exists (it doesn't in the provided contract)
    });

    it("should allow a designated admin (non-owner) to delist artwork", async function () {
      const { artGallery, owner, admin, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture);
      const adminAddress = getAddress(admin.account.address);

      // Owner makes 'admin' an admin
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const addAdminTx = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: addAdminTx });

      // Admin delists
      const artGalleryAsAdmin = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: admin } },
      );
      const delistTx = await artGalleryAsAdmin.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: delistTx });

      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;
    });

    it("should not allow the artwork owner (if not admin) to delist artwork", async function () {
      const { artGallery, artist1, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      // artist1 owns the token but is not admin
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(
        artGalleryAsArtist.write.delistArtwork([tokenId!]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("should not allow non-admin/non-owner to delist artwork", async function () {
      const { artGallery, buyer1, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsBuyer = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: buyer1 } },
      );

      await expect(
        artGalleryAsBuyer.write.delistArtwork([tokenId!]),
      ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
    });

    it("should revert when trying to delist non-existent artwork", async function () {
      const { artGallery, owner } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const nonExistentTokenId = 999n;

      await expect(
        artGalleryAsOwner.write.delistArtwork([nonExistentTokenId]),
      ).to.be.rejectedWith("ERC721NonexistentToken"); // ownerOf check fails
    });

    it("should succeed but have no effect when delisting already delisted artwork", async function () {
      const { artGallery, owner, publicClient, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Delist first time
      const tx1 = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;

      // Delist second time
      const tx2 = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: tx2 });

      // State should remain unchanged (still not for sale)
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;
      // No specific event emitted for delist in the contract to check here
    });
  });

  describe("Pause Functionality", function () {
    it("should allow owner to pause and unpause", async function () {
      const { artGallery, owner, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
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

    it("should not allow non-owner to pause or unpause", async function () {
      const { artGallery, artist1 } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      await expect(artGalleryAsArtist.write.pause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );
      // Try unpausing (even though not paused)
      await expect(artGalleryAsArtist.write.unpause()).to.be.rejectedWith(
        "OwnableUnauthorizedAccount",
      );
    });

    it("should prevent listing artwork when paused", async function () {
      const { artGallery, owner, artist1, testURI, oneEther, publicClient } =
        await loadFixture(deployArtGalleryMarketplaceFixture);
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

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });

      // Attempt list
      await expect(
        artGalleryAsArtist.write.listArtwork([testURI, oneEther]),
      ).to.be.rejectedWith("EnforcedPause()");

      // Unpause and verify listing works
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });

      const listTx = await artGalleryAsArtist.write.listArtwork([
        testURI,
        oneEther,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: listTx,
      });
      expect(receipt.status).to.equal("success");
    });

    it("should prevent buying artwork when paused", async function () {
      const { artGallery, owner, buyer1, oneEther, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture); // Start with a listed token

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

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });

      // Attempt buy
      await expect(
        artGalleryAsBuyer.write.buyArtwork([tokenId!], { value: oneEther }),
      ).to.be.rejectedWith("EnforcedPause()"); // This expectation assumes buyArtwork is pausable

      // Unpause and verify buying works
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });

      const buyTx = await artGalleryAsBuyer.write.buyArtwork([tokenId!], {
        value: oneEther,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: buyTx,
      });
      expect(receipt.status).to.equal("success");
    });

    it("should prevent updating price when paused", async function () {
      const { artGallery, owner, twoEther, publicClient, tokenId } =
        await loadFixture(createListedArtworkFixture);
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });

      // Attempt update price
      await expect(
        artGalleryAsOwner.write.updatePrice([tokenId!, twoEther]),
        // Note: updatePrice also lacks whenNotPaused in the provided contract. Assuming it should be pausable.
      ).to.be.rejectedWith("EnforcedPause()");

      // Unpause and verify update works
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });

      const updateTx = await artGalleryAsOwner.write.updatePrice([
        tokenId!,
        twoEther,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: updateTx,
      });
      expect(receipt.status).to.equal("success");
    });

    it("should prevent delisting artwork when paused", async function () {
      const { artGallery, owner, publicClient, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });

      // Attempt delist
      await expect(
        artGalleryAsOwner.write.delistArtwork([tokenId!]),
        // Note: delistArtwork also lacks whenNotPaused. Assuming it should be pausable.
      ).to.be.rejectedWith("EnforcedPause()");

      // Unpause and verify delist works
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });

      const delistTx = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: delistTx,
      });
      expect(receipt.status).to.equal("success");
    });

    it("should prevent admin/royalty changes when paused", async function () {
      const { artGallery, owner, admin, publicClient } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const adminAddress = getAddress(admin.account.address);

      // Pause
      const pauseTx = await artGalleryAsOwner.write.pause();
      await publicClient.waitForTransactionReceipt({ hash: pauseTx });

      // Attempt admin change
      await expect(
        artGalleryAsOwner.write.setAdmin([adminAddress, true]),
        // Note: setAdmin lacks whenNotPaused. Assuming it should be pausable.
      ).to.be.rejectedWith("EnforcedPause()");

      // Attempt royalty change
      await expect(
        artGalleryAsOwner.write.setRoyaltyFee([500n]),
        // Note: setRoyaltyFee lacks whenNotPaused. Assuming it should be pausable.
      ).to.be.rejectedWith("EnforcedPause()");

      // Unpause and verify changes work
      const unpauseTx = await artGalleryAsOwner.write.unpause();
      await publicClient.waitForTransactionReceipt({ hash: unpauseTx });

      const adminTx = await artGalleryAsOwner.write.setAdmin([
        adminAddress,
        true,
      ]);
      const adminReceipt = await publicClient.waitForTransactionReceipt({
        hash: adminTx,
      });
      expect(adminReceipt.status).to.equal("success");

      const royaltyTx = await artGalleryAsOwner.write.setRoyaltyFee([500n]);
      const royaltyReceipt = await publicClient.waitForTransactionReceipt({
        hash: royaltyTx,
      });
      expect(royaltyReceipt.status).to.equal("success");
    });
  });

  describe("View Functions", function () {
    it("getArtwork should return correct details for listed artwork", async function () {
      const { artGallery, artist1, oneEther, testURI, tokenId } =
        await loadFixture(createListedArtworkFixture);
      const artistAddress = getAddress(artist1.account.address);

      const artwork = await artGallery.read.getArtwork([tokenId!]);

      expect(artwork.price).to.equal(oneEther);
      expect(artwork.isForSale).to.be.true;
      expect(artwork.artist).to.equal(artistAddress); // Original artist
    });

    it("getArtwork should return correct details for sold artwork", async function () {
      const { artGallery, artist1, oneEther, tokenId, firstBuyer } =
        await loadFixture(createSoldArtworkFixture);
      const artistAddress = getAddress(artist1.account.address); // Original artist
      const buyerAddress = getAddress(firstBuyer.account.address); // Current owner

      const artwork = await artGallery.read.getArtwork([tokenId!]);

      expect(artwork.price).to.equal(oneEther); // Price remains
      expect(artwork.isForSale).to.be.false; // Not for sale after purchase
      expect(artwork.artist).to.equal(artistAddress); // Original artist stored
      expect(await artGallery.read.ownerOf([tokenId!])).to.equal(buyerAddress); // Check current owner separately
    });

    it("getArtwork should return default values for non-existent artwork", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const nonExistentTokenId = 999n;
      const artwork = await artGallery.read.getArtwork([nonExistentTokenId]);

      expect(artwork.price).to.equal(0n);
      expect(artwork.isForSale).to.be.false;
      expect(artwork.artist).to.equal(zeroAddress);
    });

    it("isArtworkForSale should return correct status", async function () {
      const { artGallery, owner, publicClient, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.true;

      // Delist it
      const artGalleryAsOwner = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: owner } },
      );
      const tx = await artGalleryAsOwner.write.delistArtwork([tokenId!]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      expect(await artGallery.read.isArtworkForSale([tokenId!])).to.be.false;
    });

    it("getPrice should return the correct price", async function () {
      const { artGallery, oneEther, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      expect(await artGallery.read.getPrice([tokenId!])).to.equal(oneEther);
    });

    it("getPrice should return zero for non-existent artwork", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const nonExistentTokenId = 999n;
      expect(await artGallery.read.getPrice([nonExistentTokenId])).to.equal(0n);
    });

    it("getTotalArtworks should reflect the number of minted tokens", async function () {
      const { artGallery, artist1, testURI, oneEther, publicClient } =
        await loadFixture(deployArtGalleryMarketplaceFixture);
      expect(await artGallery.read.getTotalArtworks()).to.equal(0n);

      const artGalleryAsArtist = await hre.viem.getContractAt(
        "ArtGalleryMarketplace",
        artGallery.address,
        { client: { wallet: artist1 } },
      );

      // List first
      const tx1 = await artGalleryAsArtist.write.listArtwork([
        testURI + "1",
        oneEther,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx1 });
      expect(await artGallery.read.getTotalArtworks()).to.equal(1n);

      // List second
      const tx2 = await artGalleryAsArtist.write.listArtwork([
        testURI + "2",
        oneEther,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx2 });
      expect(await artGallery.read.getTotalArtworks()).to.equal(2n);
    });

    it("tokenURI should return the correct URI", async function () {
      const { artGallery, testURI, tokenId } = await loadFixture(
        createListedArtworkFixture,
      );
      expect(await artGallery.read.tokenURI([tokenId!])).to.equal(testURI);
    });

    it("tokenURI should revert for non-existent token", async function () {
      const { artGallery } = await loadFixture(
        deployArtGalleryMarketplaceFixture,
      );
      const nonExistentTokenId = 999n;
      await expect(
        artGallery.read.tokenURI([nonExistentTokenId]),
      ).to.be.rejectedWith("ERC721NonexistentToken");
    });
  });
});
