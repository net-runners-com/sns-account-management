// Threads GraphQL doc_id レジストリ (ライブラリ同梱)
//
// このファイルがソース・オブ・トゥルース. accounts.json._graphql_docs があれば
// per-account で上書き可能 (Meta rotate 時の応急処置用).
//
// Meta が rotate したら capture_insights.mjs で再取得 → このファイル更新.

export const BUNDLED_DOC_IDS = {
  // Like / Unlike / Repost
  useTHLikeMutationLikeMutation: "24753372994365040",
  useTHLikeMutationUnlikeMutation: "24987148517646229",
  useTHCreateRepostMutation: "24613149815047736",

  // DM
  BcnSendTextMessageMutation: "5463537911313768451759551150",
  BcnSendPhotoMessageMutation: "171274936116350253476733476178",
  BcnSendMediaMessageMutation: "199926375418049491953832500358",
  BcnSendExternalMediaMessageMutation: "12849663468009248888529793341",
  BcnUnSendMessageMutation: "27932620007939298206506407223",
  BcnSetReactionMutation: "15914597165720263141716835061",
  BcnRemoveReactionMutation: "302547724217506061041828021720",
  BcnPublishTypingIndicatorEventMutation: "303437791118206576918931355838",
  BcnSlideUsersQuery: "143696284417247451030879989526",
  BcnSlideReachabilityStatusQuery: "17710897616465303165818839957",
  BcnInboxSnapshotQuery: "183758889610747904984751777022",
  InboxFolderBadgeQuery: "69263435214315057979264869621",
  // Frida 2026-04-27 capture (mobile endpoint i.instagram.com/graphql_www 用)
  BcnInboxMultiMessagesQuery: "114139689717096249145258989549",  // root: multifetch__SlideMessage (thread内メッセージ取得)
  BcnMarkThreadReadMutation: "17414467853782027810345426547",     // root: slide_mark_thread_read
  InboxFolderSeenMutation: "94641593416799576996894502497",       // root: mark_folder_seen

  // Follow / Profile / Posts
  useTHFollowMutationFollowMutation: "26234294899535416",
  useTHDeletePostMutation: "27448743884728086",
  BarcelonaProfileThreadsTabDirectQuery: "26413847278244505",
  BarcelonaProfileThreadsTabQuery: "27224795300468294",
  BarcelonaPostOverflowMenuPopoverQuery: "26697163296562795",

  // Insights
  useBarcelonaSetInsightsSeenMutation: "29556527977293794",
  BarcelonaInsightsPageAccountInsightsQuery: "25171287439131720",
  BarcelonaPostInsightsDialogQuery: "25176453191985664",

  // GIF (Giphy via Threads)
  BarcelonaAnimatedImageAttachmentPickerRefetchQuery: "26056475010638515",

  // User search (アカウント検索, シャドウバン検知に必須)
  useBarcelonaAccountSearchGraphQLDataSourceQuery: "26405397225812196",

  // Keyword search (本文検索 SERP). Meta rotate 時は capture_search_docid.mjs で再取得.
  BarcelonaSearchResultsRefetchableQuery: "27119638680961657",

  // Profile edit (自分のプロフィール編集)
  BarcelonaProfileEditDialogQuery: "34761408790172749",
  useBarcelonaEditProfileMutation: "25952116831133349",
  useBarcelonaUpdateBioInterestsMutation: "33027210806894847",
  BarcelonaEditProfileLinksPageQuery: "9653426861418870",
  useBarcelonaCreateOrUpdateBioLinkMutation: "9651752851573048",
  useBarcelonaRemoveBioLinkMutation: "9258872224240446",
  useBarcelonaShowIGBadgeMutationMutation: "31510667375198666",

  // Activity feed / Realtime
  BarcelonaActivityFeedStoryListContainerQuery: "26036597189352620",
  BarcelonaActivityFeedMarkInboxAsSeenMutation: "10040679232622819",
  BarcelonaLightspeedSyncQuery: "26454507537562938",
  BarcelonaNotificationBadgeContextQueryDirectQuery: "29486886354289124",
};
