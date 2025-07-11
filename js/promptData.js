import { getOAuth2Config } from '../config/oauth-config.js';

// --- Email Verification ---
export const sendEmailVerification = async (user = null) => {
  const currentUser = user || (auth ? auth.currentUser : null);
  if (!currentUser) {
    const err = new Error(getText('AUTH_NOT_AVAILABLE'));
    Utils.handleError(err.message, { userVisible: true, originalError: err });
    return Promise.reject(err);
  }
  try {
    await firebaseSendEmailVerification(currentUser);
    return true;
  } catch (error) {
    Utils.handleError(textManager.format('EMAIL_VERIFICATION_ERROR', { message: error.message }), {
      userVisible: true,
      originalError: error,
    });
    return Promise.reject(error);
  }
};

export const checkEmailVerified = async () => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    return false;
  }
  try {
    // Reload user to get latest verification status
    await firebaseReload(currentUser);
    return currentUser.emailVerified;
  } catch (error) {
    console.error('Error checking email verification status:', error);
    return false;
  }
};

// --- Password Reset ---
export const sendResetPasswordEmail = async email => {
  if (!auth) {
    const err = new Error(getText('AUTH_NOT_AVAILABLE'));
    Utils.handleError(err.message, { userVisible: true, originalError: err });
    return Promise.reject(err);
  }
  try {
    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (error) {
    Utils.handleError(textManager.format('RESET_PASSWORD_ERROR', { message: error.message }), {
      userVisible: true,
      originalError: error,
    });
    return Promise.reject(error);
  }
};

import {
  auth,
  db,
  functions,
  // Auth functions
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  firebaseSignOut,
  firebaseOnAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  updateProfile,
  sendPasswordResetEmail,
  firebaseSendEmailVerification,
  firebaseReload,
  // Firestore functions
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
  // Functions
  httpsCallable,
} from '../js/firebase-init.js';
import * as Utils from '../js/utils.js';
import { textManager, getText } from './text-constants.js';

// --- Firebase Authentication Functions ---
export const signupUser = async (email, password, displayName) => {
  if (!auth) {
    const err = new Error(getText('AUTH_NOT_AVAILABLE'));
    Utils.handleError(err.message, { userVisible: true, originalError: err });
    return Promise.reject(err);
  }
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    // console.log('User signed up:', userCredential.user);

    if (userCredential.user && displayName) {
      try {
        await updateProfile(userCredential.user, { displayName: displayName });
      } catch (profileError) {
        console.error('Error updating Firebase Auth profile:', profileError);
        Utils.handleError(getText('PROFILE_UPDATE_ERROR'), {
          userVisible: false,
          originalError: profileError,
        });
      }
    }

    if (db) {
      try {
        const userDocRef = doc(db, 'users', userCredential.user.uid);
        await setDoc(userDocRef, {
          email: userCredential.user.email,
          displayName: displayName,
          createdAt: serverTimestamp(),
          emailVerified: false, // Will be updated when email is verified
        });
      } catch (dbError) {
        console.error('Error creating user document in Firestore:', dbError);
        Utils.handleError(getText('USER_DOC_ERROR'), {
          userVisible: true,
          originalError: dbError,
        });
      }
    }

    // Send email verification
    try {
      await firebaseSendEmailVerification(userCredential.user);
      console.log('Email verification sent to:', userCredential.user.email);
    } catch (verificationError) {
      console.error('Error sending email verification:', verificationError);
      // Don't fail the signup process if email verification fails
      Utils.handleError(getText('EMAIL_VERIFICATION_SEND_ERROR'), {
        userVisible: true,
        originalError: verificationError,
      });
    }

    return userCredential;
  } catch (error) {
    Utils.handleError(textManager.format('SIGNUP_ERROR', { message: error.message }), {
      userVisible: true,
      originalError: error,
    });
    return Promise.reject(error);
  }
};

export const loginUser = async (email, password) => {
  if (!auth) {
    const err = new Error(getText('AUTH_NOT_AVAILABLE'));
    Utils.handleError(err.message, { userVisible: true, originalError: err });
    return Promise.reject(err);
  }
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential;
  } catch (error) {
    Utils.handleError(textManager.format('LOGIN_ERROR', { message: error.message }), {
      userVisible: true,
      originalError: error,
    });
    return Promise.reject(error);
  }
};

export const signInWithGoogle = async () => {
  if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.launchWebAuthFlow) {
    const errMsg = getText('CHROME_IDENTITY_NOT_AVAILABLE');
    console.error(errMsg);
    Utils.handleError(errMsg, { userVisible: true });
    return Promise.reject(new Error(errMsg));
  }
  if (!auth) {
    const errMsg = getText('AUTH_NOT_AVAILABLE');
    console.error(errMsg);
    Utils.handleError(errMsg, { userVisible: true });
    return Promise.reject(new Error(errMsg));
  }

  try {
    // Use cross-browser compatible OAuth2 configuration
    const oauth2Config = getOAuth2Config();

    if (!oauth2Config) {
      throw new Error('OAuth2 configuration not found');
    }

    const { client_id: clientId, scopes } = oauth2Config;
    const redirectUri = chrome.identity.getRedirectURL();
    const nonce = Math.random().toString(36).substring(2, 15);

    let authUrl = `https://accounts.google.com/o/oauth2/v2/auth`;
    authUrl += `?client_id=${clientId}`;
    authUrl += `&redirect_uri=${encodeURIComponent(redirectUri)}`;
    authUrl += `&response_type=id_token`;
    authUrl += `&scope=${encodeURIComponent(scopes.join(' '))}`;
    authUrl += `&nonce=${nonce}`;

    const callbackUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, responseUrl => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message;
          if (msg && msg.includes('The user did not approve access')) {
            // User cancelled: do not treat as error, but log info
            console.info(getText('GOOGLE_SIGNIN_CANCELLED'));
            resolve(null);
          } else {
            reject(new Error(msg));
          }
        } else if (!responseUrl) {
          // User closed/cancelled: do not treat as error, but log info
          console.info(getText('GOOGLE_SIGNIN_CANCELLED_POPUP'));
          resolve(null);
        } else {
          resolve(responseUrl);
        }
      });
    });

    if (!callbackUrl) {
      // User cancelled, do nothing (no error)
      return null;
    }

    const params = new URLSearchParams(callbackUrl.substring(callbackUrl.indexOf('#') + 1));
    const idToken = params.get('id_token');

    if (!idToken) {
      const errMsg = getText('GOOGLE_SIGNIN_ID_TOKEN_NOT_FOUND');
      console.error(errMsg, 'Callback URL params:', params.toString());
      Utils.handleError(errMsg, { userVisible: true });
      return Promise.reject(new Error(errMsg));
    }

    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);

    if (db && userCredential.user) {
      const userDocRef = doc(db, 'users', userCredential.user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) {
        try {
          await setDoc(userDocRef, {
            email: userCredential.user.email,
            displayName: userCredential.user.displayName || userCredential.user.email,
            createdAt: serverTimestamp(),
            photoURL: userCredential.user.photoURL || null,
          });
        } catch (dbError) {
          console.error(
            'Error creating user document for Google user (launchWebAuthFlow):',
            dbError
          );
          Utils.handleError(getText('GOOGLE_USER_DETAILS_SAVE_ERROR'), {
            userVisible: true,
            originalError: dbError,
          });
        }
      }
    }
    return userCredential;
  } catch (error) {
    // Only log as error if not user cancellation
    if (error && error.message && error.message.includes('The user did not approve access')) {
      // User cancelled: log info, do not log as error
      console.info(getText('GOOGLE_SIGNIN_CANCELLED'));
      return null;
    }
    console.error('Error in signInWithGoogle (launchWebAuthFlow) flow:', error);
    const errMsg = error.message || getText('GOOGLE_SIGNIN_UNKNOWN_ERROR');
    Utils.handleError(errMsg, { userVisible: true, originalError: error });
    return Promise.reject(error);
  }
};

export const logoutUser = async () => {
  if (!auth) {
    Utils.handleError(getText('FIREBASE_AUTH_NOT_AVAILABLE'), { userVisible: true });
    return Promise.resolve(false);
  }
  try {
    await firebaseSignOut(auth);
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(getText('LOGOUT_SUCCESS'), { type: 'success', duration: 3000 });
    }
    return true;
  } catch (error) {
    Utils.handleError(`Logout error (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return false;
  }
};

export const onAuthStateChanged = callback => {
  if (!auth) {
    Utils.handleError(getText('FIREBASE_AUTH_NOT_AVAILABLE'), { userVisible: false });
    callback(null);
    return () => {};
  }
  return firebaseOnAuthStateChanged(auth, callback);
};

// --- Prompt Functions (Firestore) ---
export const addPrompt = async promptData => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    Utils.handleError(getText('LOGIN_TO_ADD_PROMPT'), { userVisible: true });
    return null;
  }
  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE'), { userVisible: true });
    return null;
  }
  try {
    const newPromptDocData = {
      userId: currentUser.uid,
      authorDisplayName: currentUser.displayName || currentUser.email,
      title: promptData.title || '',
      text: promptData.text || '',
      description: promptData.description || '',
      category: promptData.category || '',
      tags: promptData.tags || [],
      targetAiTools: promptData.targetAiTools || [],
      isPrivate: !!promptData.isPrivate,
      averageRating: 0,
      totalRatingsCount: 0,
      favoritesCount: 0,
      usageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'prompts'), newPromptDocData);
    const locallySimulatedTimestamps = { createdAt: new Date(), updatedAt: new Date() };
    return {
      ...newPromptDocData,
      ...locallySimulatedTimestamps,
      id: docRef.id,
      currentUserRating: 0,
      currentUserIsFavorite: false,
    };
  } catch (error) {
    Utils.handleError(`Error adding prompt to Firestore (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return null;
  }
};

export const ratePrompt = async (promptId, ratingValue) => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    Utils.handleError(getText('LOGIN_TO_RATE_PROMPT'), { userVisible: true });
    return null;
  }
  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE_GENERAL'), { userVisible: true });
    return null;
  }
  if (typeof ratingValue !== 'number' || ratingValue < 1 || ratingValue > 5) {
    Utils.handleError(getText('INVALID_RATING'), {
      userVisible: true,
    });
    return null;
  }

  const promptRef = doc(db, 'prompts', promptId);
  const ratingDocRef = doc(db, 'prompts', promptId, 'ratings', currentUser.uid);

  try {
    // Set the rating document - the cloud function will handle the aggregation
    await setDoc(ratingDocRef, {
      rating: ratingValue,
      ratedAt: serverTimestamp(),
      userId: currentUser.uid,
    });

    // Poll for updated averageRating (max 2s, check every 250ms)
    let updatedPromptSnap;
    let promptDataToReturn;
    let attempts = 0;
    const maxAttempts = 8; // 8 * 250ms = 2s
    let lastAverageRating = null;
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 250));
      updatedPromptSnap = await getDoc(promptRef);
      promptDataToReturn = formatLoadedPrompt(updatedPromptSnap, ratingValue);
      // If averageRating is present and changed, break early
      if (
        typeof promptDataToReturn.averageRating === 'number' &&
        (lastAverageRating === null || promptDataToReturn.averageRating !== lastAverageRating)
      ) {
        break;
      }
      lastAverageRating = promptDataToReturn.averageRating;
      attempts++;
    }

    // Also update currentUserIsFavorite
    const favoritedByDocRef = doc(db, 'prompts', promptId, 'favoritedBy', currentUser.uid);
    const favoritedBySnap = await getDoc(favoritedByDocRef);
    promptDataToReturn.currentUserIsFavorite = favoritedBySnap.exists();

    return promptDataToReturn;
  } catch (error) {
    Utils.handleError(`Error submitting rating for prompt ${promptId}: ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return null;
  }
};

const formatLoadedPrompt = (
  docSnapshot,
  currentUserRating = null,
  currentUserIsFavorite = false
) => {
  const data = docSnapshot.data();
  const convertTimestamp = ts =>
    ts instanceof Timestamp ? ts.toDate().toISOString() : ts ? new Date(ts).toISOString() : null;

  const formatted = {
    id: docSnapshot.id,
    ...data,
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt),
    currentUserIsFavorite: currentUserIsFavorite,
  };
  if (currentUserRating !== null && currentUserRating !== undefined) {
    formatted.currentUserRating = currentUserRating;
  }
  return formatted;
};

export const loadPrompts = async () => {
  const currentUser = auth ? auth.currentUser : null;
  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE_LOADING'), { userVisible: true });
    return [];
  }

  try {
    let combinedPromptDocs = [];
    const fetchedPromptIds = new Set();

    if (currentUser) {
      const userPromptsQuery = query(
        collection(db, 'prompts'),
        where('userId', '==', currentUser.uid)
      );
      const userPromptsSnapshot = await getDocs(userPromptsQuery);
      userPromptsSnapshot.forEach(doc => {
        if (!fetchedPromptIds.has(doc.id)) {
          combinedPromptDocs.push(doc);
          fetchedPromptIds.add(doc.id);
        }
      });
    }

    const publicPromptsQuery = query(collection(db, 'prompts'), where('isPrivate', '==', false));
    const publicPromptsSnapshot = await getDocs(publicPromptsQuery);

    publicPromptsSnapshot.forEach(doc => {
      if (!fetchedPromptIds.has(doc.id)) {
        if (!(currentUser && doc.data().userId === currentUser.uid)) {
          combinedPromptDocs.push(doc);
          fetchedPromptIds.add(doc.id);
        }
      }
    });

    const enrichedPrompts = await Promise.all(
      combinedPromptDocs.map(async docSnap => {
        let userRating = null;
        let userIsFavorite = false;
        if (currentUser) {
          const ratingDocRef = doc(db, 'prompts', docSnap.id, 'ratings', currentUser.uid);
          const ratingSnap = await getDoc(ratingDocRef);
          if (ratingSnap.exists()) {
            userRating = ratingSnap.data().rating;
          }
          const favoriteDocRef = doc(db, 'prompts', docSnap.id, 'favoritedBy', currentUser.uid);
          const favoriteSnap = await getDoc(favoriteDocRef);
          userIsFavorite = favoriteSnap.exists();
        }
        return formatLoadedPrompt(docSnap, userRating, userIsFavorite);
      })
    );
    return enrichedPrompts;
  } catch (error) {
    Utils.handleError(`Error loading prompts from Firestore (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return [];
  }
};

export const findPromptById = async (promptId, _promptsUnused = null, options = {}) => {
  const { throwIfNotFound = false, handleError = true } = options;
  if (!promptId) {
    return null;
  }
  if (!db) {
    const msg = getText('FIRESTORE_NOT_AVAILABLE_GENERAL');
    console.error(msg);
    if (handleError && Utils && Utils.handleError) Utils.handleError(msg, { userVisible: true });
    return null;
  }

  try {
    const docRef = doc(db, 'prompts', promptId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      let currentUserRating = null;
      let currentUserIsFavorite = false;
      const currentUser = auth ? auth.currentUser : null;
      if (currentUser) {
        const ratingDocRef = doc(db, 'prompts', promptId, 'ratings', currentUser.uid);
        const ratingSnap = await getDoc(ratingDocRef);
        if (ratingSnap.exists()) {
          currentUserRating = ratingSnap.data().rating;
        }
        const favoriteDocRef = doc(db, 'prompts', promptId, 'favoritedBy', currentUser.uid);
        const favoriteSnap = await getDoc(favoriteDocRef);
        currentUserIsFavorite = favoriteSnap.exists();
      }
      return formatLoadedPrompt(docSnap, currentUserRating, currentUserIsFavorite);
    } else {
      const err = new Error(`Prompt with ID ${promptId} not found in Firestore (v9)`);
      if (handleError && Utils && Utils.handleError) {
        Utils.handleError(err.message, { userVisible: true, originalError: err });
      }
      if (throwIfNotFound) {
        throw err;
      }
      return null;
    }
  } catch (error) {
    if (handleError && Utils && Utils.handleError) {
      if (!(error.message.includes('not found in Firestore') && throwIfNotFound)) {
        Utils.handleError(`Error retrieving prompt ${promptId} (v9): ${error.message}`, {
          userVisible: true,
          originalError: error,
        });
      }
    }
    if (throwIfNotFound && error.message.includes('not found in Firestore')) throw error;
    return null;
  }
};

export const updatePrompt = async (promptId, updates) => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    Utils.handleError(getText('LOGIN_TO_UPDATE_PROMPT'), { userVisible: true });
    return null;
  }
  const allowedUpdates = { ...updates };
  delete allowedUpdates.userIsFavorite;
  delete allowedUpdates.currentUserRating;
  // delete allowedUpdates.currentUserIsFavorite; // This was a duplicate
  delete allowedUpdates.favoritesCount;
  delete allowedUpdates.averageRating;
  delete allowedUpdates.totalRatingsCount;

  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE_GENERAL'), { userVisible: true });
    return null;
  }
  if (!promptId) {
    Utils.handleError(getText('NO_PROMPT_ID_UPDATE'), { userVisible: true });
    return null;
  }
  if (!allowedUpdates || Object.keys(allowedUpdates).length === 0) {
    // No actual content fields to update, only internal ones were passed or empty object.
    // This might still proceed to update 'updatedAt' if desired.
  }

  try {
    const docRef = doc(db, 'prompts', promptId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      Utils.handleError(`Prompt with ID ${promptId} not found for update (v9).`, {
        userVisible: true,
      });
      return null;
    }
    if (docSnap.data().userId !== currentUser.uid) {
      Utils.handleError(getText('NO_PERMISSION_UPDATE'), {
        userVisible: true,
      });
      return null;
    }

    const updateData = { ...allowedUpdates, updatedAt: serverTimestamp() };
    await updateDoc(docRef, updateData);

    return findPromptById(promptId);
  } catch (error) {
    Utils.handleError(`Error updating prompt ${promptId} in Firestore (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return null;
  }
};

export const deletePrompt = async promptId => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    Utils.handleError(getText('LOGIN_TO_DELETE_PROMPT'), { userVisible: true });
    return false;
  }
  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE_GENERAL'), { userVisible: true });
    return false;
  }
  if (!promptId) {
    Utils.handleError('No prompt ID provided for deletion.', { userVisible: true });
    return false;
  }

  try {
    const docRef = doc(db, 'prompts', promptId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      Utils.handleError(`Prompt with ID ${promptId} not found for deletion (v9).`, {
        userVisible: true,
      });
      return false;
    }
    if (docSnap.data().userId !== currentUser.uid) {
      Utils.handleError('You do not have permission to delete this prompt (v9).', {
        userVisible: true,
      });
      return false;
    }
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    Utils.handleError(`Error deleting prompt ${promptId} (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return false;
  }
};

export const toggleFavorite = async promptId => {
  const currentUser = auth ? auth.currentUser : null;
  if (!currentUser) {
    Utils.handleError('User must be logged in to change favorite status.', { userVisible: true });
    return null;
  }
  if (!db) {
    Utils.handleError(getText('FIRESTORE_NOT_AVAILABLE_GENERAL'), { userVisible: true });
    return null;
  }
  if (!promptId) {
    Utils.handleError('No prompt ID provided for toggling favorite.', { userVisible: true });
    return null;
  }

  const promptRef = doc(db, 'prompts', promptId);
  const favoritedByDocRef = doc(db, 'prompts', promptId, 'favoritedBy', currentUser.uid);

  try {
    const currentPromptSnap = await getDoc(promptRef);
    if (!currentPromptSnap.exists()) {
      Utils.handleError(`Prompt ${promptId} not found for toggling favorite.`, {
        userVisible: true,
      });
      return null;
    }

    // Check if the user has already favorited this prompt
    const favoritedBySnap = await getDoc(favoritedByDocRef);

    // Simply add or remove the favorite document
    // The cloud function will handle updating the favoritesCount
    if (favoritedBySnap.exists()) {
      await deleteDoc(favoritedByDocRef);
    } else {
      await setDoc(favoritedByDocRef, {
        favoritedAt: serverTimestamp(),
        userId: currentUser.uid,
      });
    }

    // Wait a moment for the cloud function to process
    // In a production app, you might consider implementing a more sophisticated
    // approach that doesn't rely on this delay
    await new Promise(resolve => setTimeout(resolve, 300));

    return findPromptById(promptId);
  } catch (error) {
    Utils.handleError(`Error toggling favorite for prompt ${promptId} (v9): ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return null;
  }
};

export const copyPromptToClipboard = async promptId => {
  try {
    const prompt = await findPromptById(promptId);
    if (!prompt) throw new Error(`Prompt with ID ${promptId} not found for copying (v9)`);

    await navigator.clipboard.writeText(prompt.text);

    // Try to increment usage count, but ignore expected auth errors (do not affect user experience)
    try {
      // Only try to increment usage count if user is logged in
      if (auth && auth.currentUser) {
        const incrementUsageCountFn = httpsCallable(functions, 'incrementUsageCount');
        await incrementUsageCountFn({ promptId });

        // Fetch the prompt again to get the updated usage count
        const updatedPrompt = await findPromptById(promptId);
        return { success: true, prompt: updatedPrompt };
      }
      // Skip usage tracking for logged-out users entirely
    } catch (error) {
      // Only log unexpected errors, not auth/permission errors
      const msg = error && (error.message || error.code || error.toString());
      if (
        msg &&
        (msg.includes('PERMISSION_DENIED') ||
          msg.includes('401') ||
          msg.includes('unauth') ||
          msg.includes('not authorized') ||
          msg.includes('must be logged in'))
      ) {
        // Do nothing: this is expected for logged-out users
      } else if (window && window.console) {
        // Only log truly unexpected errors
        console.warn(
          `Non-blocking: Failed to increment usage count for prompt ${promptId}:`,
          error
        );
      }
    }

    // If we didn't update and refetch (logged-out or error), return the original prompt
    return { success: true, prompt };
  } catch (error) {
    Utils.handleError(`Error copying to clipboard: ${error.message}`, {
      userVisible: true,
      originalError: error,
    });
    return { success: false };
  }
};

export const filterPrompts = (prompts, filters) => {
  let result = [...prompts];
  const currentUser = auth ? auth.currentUser : null;

  // Tab filtering
  if (filters.tab === 'favs') {
    if (!currentUser) return [];
    result = result.filter(p => p.currentUserIsFavorite === true);
  } else if (filters.tab === 'private') {
    if (!currentUser) return [];
    result = result.filter(p => p.isPrivate && p.userId === currentUser.uid);
  }

  // "Your prompts only" filter

  if (filters.yourPromptsOnly && currentUser) {
    result = result.filter(p => p.userId === currentUser.uid);
  }

  // "Used by you" filter (usageCount > 0 for this user, or a usedByYou flag)
  if (filters.usedByYou && currentUser) {
    result = result.filter(
      p => p.usedByYou === true || (Array.isArray(p.usedBy) && p.usedBy.includes(currentUser.uid))
    );
  }

  // Category filter
  if (filters.category && filters.category !== 'all') {
    result = result.filter(p => p.category === filters.category);
  }

  // Tag filter (single or multi-select)
  if (filters.tag && filters.tag !== 'all') {
    if (Array.isArray(filters.tag)) {
      result = result.filter(
        p => Array.isArray(p.tags) && filters.tag.every(tag => p.tags.includes(tag))
      );
    } else {
      result = result.filter(p => Array.isArray(p.tags) && p.tags.includes(filters.tag));
    }
  }

  // AI Tool filter
  if (filters.aiTool && filters.aiTool !== 'all') {
    result = result.filter(
      p => Array.isArray(p.targetAiTools) && p.targetAiTools.includes(filters.aiTool)
    );
  }

  // Date range filters (createdAt)
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    result = result.filter(p => p.createdAt && new Date(p.createdAt) >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    result = result.filter(p => p.createdAt && new Date(p.createdAt) <= to);
  }

  // Date range filters (updatedAt)
  if (filters.updatedFrom) {
    const from = new Date(filters.updatedFrom);
    result = result.filter(p => p.updatedAt && new Date(p.updatedAt) >= from);
  }
  if (filters.updatedTo) {
    const to = new Date(filters.updatedTo);
    result = result.filter(p => p.updatedAt && new Date(p.updatedAt) <= to);
  }

  // Search
  if (filters.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    result = result.filter(
      p =>
        (p.title && p.title.toLowerCase().includes(term)) ||
        (p.text && p.text.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(term))) ||
        (p.targetAiTools && p.targetAiTools.some(tool => tool.toLowerCase().includes(term)))
    );
  }

  // Min public/community rating (averageRating)
  if (filters.minRating > 0) {
    result = result.filter(p => {
      if (!p.isPrivate) {
        return (p.averageRating || 0) >= filters.minRating;
      }
      return false;
    });
  }

  // Min user rating (currentUserRating)
  if (filters.minUserRating > 0 && currentUser) {
    result = result.filter(p => (p.currentUserRating || 0) >= filters.minUserRating);
  }

  // Sorting
  if (filters.sortBy) {
    const dir = filters.sortDir === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'createdAt':
          return (new Date(a.createdAt) - new Date(b.createdAt)) * dir;
        case 'updatedAt':
          return (new Date(a.updatedAt) - new Date(b.updatedAt)) * dir;
        case 'averageRating':
          return ((a.averageRating || 0) - (b.averageRating || 0)) * dir;
        case 'currentUserRating':
          return ((a.currentUserRating || 0) - (b.currentUserRating || 0)) * dir;
        case 'usageCount':
          return ((a.usageCount || 0) - (b.usageCount || 0)) * dir;
        case 'favoritesCount':
          return ((a.favoritesCount || 0) - (b.favoritesCount || 0)) * dir;
        case 'title':
          return (
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }) * dir
          );
        default:
          return 0;
      }
    });
  }

  return result;
};

/**
 * Calls the searchPrompts Cloud Function to perform server-side search.
 * @param {string} query - The search query string.
 * @param {number} [limit=20] - Optional: max number of results to return.
 * @returns {Promise<object>} - The search results from the backend, including annotations.
 *
 * Each result in results[] includes:
 *   - matchedIn: Array of field names where a match occurred (e.g., ['title', 'tags'])
 *   - isExactMatch: Boolean indicating if any field was an exact match
 *   - score: The ranking score (lower is better)
 */
export async function searchPromptsServer(query, limit = 20) {
  if (!functions) {
    const err = new Error('Firebase functions not initialized.');
    Utils.handleError(err.message, { userVisible: true, originalError: err });
    return Promise.reject(err);
  }
  try {
    const callable = httpsCallable(functions, 'searchPrompts');
    const response = await callable({ query, limit });
    // Response is in response.data
    // Each result in response.data.results includes 'matchedIn' for downstream use
    return response.data;
  } catch (error) {
    Utils.handleError('Search failed: ' + (error.message || error), {
      userVisible: true,
      originalError: error,
    });
    return Promise.reject(error);
  }
}
