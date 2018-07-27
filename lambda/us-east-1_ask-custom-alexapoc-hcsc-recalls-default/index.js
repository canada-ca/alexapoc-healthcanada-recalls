/* eslint-disable  func-names */
/* eslint-disable  no-console */

const
  util = require('util'),
  Alexa = require('ask-sdk-core'),
  fetch = require('node-fetch'),
  R = require('ramda'),

  RESULTS_LIMIT = 5,
  CATEGORIES = [ "ALL", "FOOD", "VEHICLE", "HEALTH", "CPS" ],
  COLLOQUIALISMS = [ false, "first", "second", "third", "fourth", "fifth" ],
  imageEndpoint = "https://healthycanadians.gc.ca",
  apiEndpoint = "https://healthycanadians.gc.ca/recall-alert-rappel-avis/api/",
  recentUrl = `${apiEndpoint}recent/en`,
  detailUrl = `${apiEndpoint}{recallId}/en`,
  searchUrl = `${apiEndpoint}search?search={query}&lang=en{category}&lim=${RESULTS_LIMIT}&off=0`;

/**
 * @function getSlotValue
 * @description Retrieves cannonical value from intent request slots
 * @param {Object} slot Intent slot to get the value from
 * @returns {String} Slot value
 */
function getSlotValue(slot) {
  if (!slot) return null;

  let _match = null;
  
  try {
    let _matches = R.filter(match => match.status.code === "ER_SUCCESS_MATCH", slot.resolutions.resolutionsPerAuthority);
    _match = _matches[0].values[0].value.name;
  }
  catch(err) {
    console.log(`Error getting cannonical value:\n${util.inspect(err)}`);
  }

  if (!_match) try {
    _match = slot.value;
  }
  catch(err) {
    console.log(`Error getting top level value:\n${util.inspect(err)}`);
  }

  return _match;
}

/**
 * @function htmlStripper
 * @description Used to recursivly map through a JSON object and strip HTML out of string properties
 * @param {Object} data JSON object to be processed
 */
function htmlStripper(data) {
  if (typeof data === 'string') {
    // TODO: See if replaceing with space instead of blank string produces adequate results for spacing out sentances.
    data = data.replace(/(<([^>]+)>)|\r?\n|\r/ig, " ");
  }
  else if (Array.isArray(data)) {
    data = R.map(htmlStripper, data);
  }
  else if (typeof data === 'object') {
    for (let prop in data) {
      data[prop] = htmlStripper(data[prop]);
    }
  }

  return data;
}

/**
 * @function LaunchRequestHandler
 * @description Introduces the skill to the user. 
 */
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speechText = `Welcome to Health Canada's Recalls and Safety Alerts. Ask me to show you recent recalls and safety alerts for Health, Food, Consumer and/or Vehicle products.`; // TODO:  I can also notify you when new ones are published.`;

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .withSimpleCard(`Health Canada - Recalls and Safety Alerts`, speechText)
      .getResponse();
  },
};

/**
 * @function RecentRecallsIntentHandler
 * @description Lists the 5 most recent recalls to the user. User is able to filter for category type or use a search query.
 */
const RecentRecallsIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'RecentRecallsIntent';
  },
  async handle(handlerInput) {
    // TODO: 'Paginate' results, 'Alexa, [ show me more | more results | next ]'
    // Create 'offset' session attribute for pagination
    try {
      const attributes = await handlerInput.attributesManager.getSessionAttributes();
      let { category, query } = handlerInput.requestEnvelope.request.intent.slots;
      
      category = getSlotValue(category);
      query = getSlotValue(query);

      if (attributes.length) { // Persist session attributes
        handlerInput.attributesManager.setSessionAttributes(attributes);
      }

      if (typeof category === "string" && CATEGORIES.includes(category.toUpperCase())) {
        category = category.toUpperCase();
      }
      else if ((typeof query === "string" && query) || !category || !CATEGORIES.includes(category) && typeof category === "string" && category.length) {
        // TODO: Use search endpoint instead of recent to search for "any". This may require using an additional 'generic' slot type.
        // "Tell me about {query} recalls"
        // "I'll search for {category} recalls"
        // useSearchEndpoint = true;
        category = "ALL";
      }

      let 
        recent = null,
        recentText = "",
        i = 0;

      if (CATEGORIES.includes(category) && !query) {
        // Get recent recalls from API
        recent = (await (await fetch(recentUrl)).json()).results[category].slice(0, RESULTS_LIMIT);
  
        // Save recent recalls and category in session
        handlerInput.attributesManager.setSessionAttributes({
          recent,
          category
        });
  
        // Generate speech text using recent results
        for (i = 0; i < RESULTS_LIMIT; i++) {
          recentText = `${recentText} ${i + 1}: ${recent[i].title}`;
        }
  
      }
      else {
        // TODO:  Use search query to get search results and append to recentText
        let _url = searchUrl
          .replace(/{query}/, typeof query === "string" ? query : category)
          .replace(/{category}/, `&cat=${CATEGORIES.includes(category) ? CATEGORIES.indexOf(category) : 0}`)

        recent = (await (await fetch(_url)).json()).results;

        // Save recent recalls and category in session
        handlerInput.attributesManager.setSessionAttributes({
          recent,
          category
        });
      }

      let 
        fetchedText = null,
        speechText = null;

      if (!recent.length) {
        // No results were found
        speechText = `I'm sorry, I couldn't find any recalls${query ? ` related to, '${query}'` : ""}. Please try again. You may also find what you're looking for on the Recalls and Safety alerts page on canada.ca or in the mobile app on iOS or Android.`;
      }
      else {
        // Generate results speech segment.
        for (i = 0; i < RESULTS_LIMIT; i++) {
          recentText = `${recentText} ${i + 1}: ${recent[i].title}. `;
        }

        // Generate text to give contextual feedback in regards to the query that was performed.
        fetchedText = query && typeof query === "string"
          ? ` related to, '${query}'`
          : category === "ALL" 
            ? "" 
            : ` for ${category.toString()}`;

        // Generate speech text
        speechText = `Here are the latest recalls and safety alerts${fetchedText}. ${recentText}. You may ask me to tell you more about items 1 through ${RESULTS_LIMIT}.`;
      }
      
      return handlerInput.responseBuilder
        .speak(speechText)
        .reprompt(speechText)
        .withSimpleCard('Recent Recalls', speechText)
        .getResponse();
    }
    catch(err) {
      console.log("RecentRecallsIntentHandler ERROR:\n", err);

      return handlerInput.responseBuilder
        .speak("Sorry, there was an error processing your request.")
        .withSimpleCard('Recent Recalls Error', "Sorry, there was an error processing your request.")
        .getResponse();
    }
  },
};

/**
 * @function RecentRecallDetailIntentHandler
 * @description Gives a detailed briefing on the recall (TODO:) and prompts the user to select more details
 */
const RecentRecallDetailIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'RecentRecallDetailIntent';
  },
  async handle(handlerInput) {
    try {
      // Get intent slots
      let 
        i = 0,
        { index, colloquialism } = handlerInput.requestEnvelope.request.intent.slots;

      colloquialism = getSlotValue(colloquialism);
      if (colloquialism) {
        index = colloquialism && typeof colloquialism === "string"
          ? COLLOQUIALISMS.indexOf(colloquialism.toLowerCase())
          : null;
      }
      else index = getSlotValue(index);

      // Get session attributes
      const { recent } = attributes = await handlerInput.attributesManager.getSessionAttributes();

      // Persist session attributes
      if (attributes.length) {
        handlerInput.attributesManager.setSessionAttributes(attributes);
      }

      // Check if the user has any recent recalls cached in the current session
      if (!recent) {
        // The user hasn't looked up any recent recalls, return recent recalls and prompt for selection
        const recent = (await (await fetch(recentUrl)).json()).results.ALL.slice(0, RESULTS_LIMIT);
        let recentText = "";
  
        // Save recent recalls and category in session
        handlerInput.attributesManager.setSessionAttributes({
          recent,
          category: "ALL"
        });
  
        // Generate speech text using recent results
        for (i = 0; i < RESULTS_LIMIT; i++) {
          recentText = `${recentText} ${i + 1}: ${recent[i].title}`;
        }

        const speechText = `I haven't found any alerts for you yet, here are the most recent: ${recentText}. You may now ask me for more details on items 1 through ${RESULTS_LIMIT}.`;

        return handlerInput.responseBuilder
          .speak(speechText)
          .reprompt(speechText)
          .withSimpleCard('Recent Recalls', speechText)
          .getResponse();
      }

      // Get detailed recall data from API
      const 
        { recallId } = recent[parseInt(index) - 1],
        recallDetails = R.map(details => {
          try {
            for (let panel in details) {
              if (details[panel].panelName === "basic_details") {
                details[panel].text = R.filter(x => !!x, details[panel].text.split(/<br\/>/i));
              }
            }
          }
          catch(err) {
            console.log(`Error splitting basic details: ${util.inspect(err, { depth: null })}`);
          }

          return htmlStripper(details);
        }, (await (await fetch(detailUrl.replace(/{recallId}/, recallId))).json()));

      let 
        speechText = `Here are the details for ${recallDetails.title}. `,
        optionsText = "",
        image = null,
        options = [],
        products = [];
        
      // Seperate panels into contextual chunks
      for (let panel of recallDetails.panels) {
        if (panel.panelName === ("images") && Array.isArray(panel.data) && panel.data.length) {
          // Set image for card if available
          image = {
            full: `${imageEndpoint}${panel.data[0].fullUrl}`,
            thumb: `${imageEndpoint}${panel.data[0].thumbUrl}`
          };
        }
        else if (/(?:(?:basic_)?details)|(?:intro_text)/.test(panel.panelName)) {
          // Top level details, append panel text to speech
          if (panel.panelName === "basic_details") {
            speechText = `${speechText} ${panel.title}.`;
            if (Array.isArray(panel.text)) for (let basicDetail of panel.text) {
              speechText = `${speechText} ${basicDetail}.`;
            }
          }
          else {
            speechText = `${speechText} ${panel.title}. ${panel.text}.`;
          }
        }
        else if (/^product_?\d*?$/.test(panel.panelName)) {
          // Panel is an affected product, add it to list of products
          products.push(panel);
        }
        else {
          // Add to options
          options.push(panel);
        }
      }
      
      // Append options to speech text
      if (options.length) {
        optionsText = `You can ask me for${products.length ? " summary options a list of affected products or " : " "}`;
        
        for (i = 0; i < options.length; i++) {
          optionsText = `${optionsText}${options[i].title}${i < (options.length - 1) ? " or " : "."}`;
        }

        speechText = `${speechText} ${optionsText}`;
      }

      // Set current recall in session
      handlerInput.attributesManager.setSessionAttributes({
        current: recallDetails,
        options,
        products
      });
      
      // Send response
      let
        cardText = Array.isArray(recallDetails.panels[0].text) 
          ? recallDetails.panels[0].text.join(" ") 
          : recallDetails.panels[0].text,
        response = handlerInput.responseBuilder
          .speak(speechText)
          .reprompt(optionsText);

      response = image
        ? response.withStandardCard(recallDetails.title, cardText, image.thumb, image.full)
        : response.withSimpleCard(recallDetails.title, cardText)

      return response.getResponse();
    }
    catch(err) {
      console.log("RecentRecallDetailsIntentHandler ERROR:\n", err);

      return handlerInput.responseBuilder
        .speak("Sorry, there was an error processing your request.")
        .withSimpleCard('Recent Recalls Error', "Sorry, there was an error processing your request.")
        .getResponse();
    }
  },
};

/**
 * @function CurrentRecallPanelIntentHandler
 * @description Gets further detailed information on the current recall for the user. Data is based on panel types.
 */
const CurrentRecallPanelIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'CurrentRecallPanelIntent';
  },
  async handle(handlerInput) {
    try {
      let { panel } = handlerInput.requestEnvelope.request.intent.slots;
      
      panel = getSlotValue(panel);

      const { options, products } = attributes = await handlerInput.attributesManager.getSessionAttributes();

      // Persist session attributes
      if (attributes.length) {
        handlerInput.attributesManager.setSessionAttributes(attributes);
      }

      // Filter out current panel from options
      const 
        panelRegex = new RegExp(panel, "i"),
        currentPanel = R.filter(_panel => panelRegex.test(_panel.title), options)[0];

      let
        optionsText = "",
        speechText =  "";

      if (/(?:list)\s(?:of)\saffected\sproducts/i.test(panel)) {
        // Add list of products to speech text
        let productText = "";

        if (!products.length) {
          productText = "There is no available list of affected products.";
        }
        else {
          for (let product of products) {
            productText = `${productText} ${product.title}.`;
          }
          speechText = `${speechText} ${productText}`;
        }
      }
      else {
        // Add current panel to speech text
        speechText = currentPanel
          ? `${Array.isArray(currentPanel) ? currentPanel.text.join(" ") : currentPanel.text}`
          : `Sorry, I don't know that option, ${panel}.`;
      }


      // Append options to speech text
      if (options.length) {
        optionsText = `You can ask me for${products.length ? " summary options a list of affected products or " : " "}`;
        
        for (i = 0; i < options.length; i++) {
          optionsText = `${optionsText}${options[i].title}${i < (options.length - 1) ? " or " : "."}`;
        }

        speechText = `${speechText} ${optionsText}`;
      }

      // TODO: Add reprompt for user to ask about other options. List out 'options.title' for user to select from.

      return handlerInput.responseBuilder
        .speak(speechText)
        .reprompt(optionsText)
        .withSimpleCard(panel, speechText)
        .getResponse();
    }
    catch(err) {
      console.log("CurrentRecallPanelIntentHandler ERROR:\n", err);

      return handlerInput.responseBuilder
        .speak("Sorry, there was an error processing your request.")
        .withSimpleCard('Recent Recalls Error', "Sorry, there was an error processing your request.")
        .getResponse();
    }
  },
};

/**
 * @function CurrentRecallSummaryIntentHandler
 * @description Gets further detailed information on the current recall for the user. Data is based on panel types.
 */
const CurrentRecallSummaryIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'CurrentRecallSummaryIntent';
  },
  async handle(handlerInput) {
    try {
      let 
        speechText = "",
        { topic } = handlerInput.requestEnvelope.request.intent.slots;
      
      topic = getSlotValue(topic);
  
      // Get summary from current recall.
      const 
        { current, options, products } = attributes = await handlerInput.attributesManager.getSessionAttributes(),
        summary = R.filter(panel => /summary/i.test(panel.title))(current.panels)[0];

      // Persist session attributes
      if (attributes.length) {
        handlerInput.attributesManager.setSessionAttributes(attributes);
      }

      if (!topic) {
        // User has asked for available summary options, list them.
        return handlerInput.responseBuilder
          .speak("You may ask me about the category, alert type or subtype, department, hazard classification, recalling firm, distribution and the extent of the product distribution.")
          .withSimpleCard("Recall summary options", R.map(item => item.split(":")[0])(summary.text).join("."))
          .getResponse();
      }
      else {
        const summary = R.find(panel => /Summary/i.test(panel.title))(current.panels);

        speechText = summary
          ? R.find(_topic => (new RegExp(topic, "i").test(_topic.split(":")[0])))(summary.text)
          : `Sorry, I don't know the summary topic '${topic}'.`;
      }

      // Append options to speech text
      if (options.length) {
        optionsText = `You can ask me for${products.length ? " summary options or a list of affected products or " : " "}`;
        
        for (i = 0; i < options.length; i++) {
          optionsText = `${optionsText}${options[i].title}${i < (options.length - 1) ? " or " : "."}`;
        }

        speechText = `${speechText} ${optionsText}`;
      }

      return handlerInput.responseBuilder
        .speak(speechText)
        .reprompt(optionsText)
        .withSimpleCard(speechText, speechText)
        .getResponse();
    }
    catch(err) {
      console.log("CurrentRecallSummaryIntentHandler ERROR:\n", err);

      return handlerInput.responseBuilder
        .speak("Sorry, there was an error processing your request.")
        .withSimpleCard('Recent Recalls Error', "Sorry, there was an error processing your request.")
        .getResponse();
    }
  },
};

// TODO: Implement
// const RecallsNotificationIntentHandler = {
//   canHandle(handlerInput) {
//     return handlerInput.requestEnvelope.request.type === 'IntentRequest'
//       && handlerInput.requestEnvelope.request.intent.name === 'RecallsNotificationIntent';
//   },
//   async handle(handlerInput) {
//     try {
//       const 
//         attributes = await handlerInput.attributesManager.getSessionAttributes(),
//         // { } = handlerInput.requestEnvelope.request.intent.slots
//         ;

//       if (attributes.length) { // Persist session attributes
//         handlerInput.attributesManager.setSessionAttributes(attributes);
//       }

//       let speechText = `This feature is currently under development, please try again later.`;

//       return handlerInput.responseBuilder
//         .speak(speechText)
//         .withSimpleCard(_details.title, speechText)
//         .getResponse();
//     }
//     catch(err) {
//       console.log("RecallsNotificationIntentHandler ERROR:\n", err);

//       return handlerInput.responseBuilder
//         .speak("Sorry, there was an error processing your request.")
//         .withSimpleCard('Recalls Notification Error', "Sorry, there was an error processing your request.")
//         .getResponse();
//     }
//   },
// };

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'You can say hello to me!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .withSimpleCard('Hello World', speechText)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speechText = 'Goodbye!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Recalls and Safety Alerts', speechText)
      .getResponse();
  },
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);

    return handlerInput.responseBuilder
      .speak('Sorry, I can\'t understand the command. Please say again.')
      .reprompt('Sorry, I can\'t understand the command. Please say again.')
      .getResponse();
  },
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestHandlers(
    LaunchRequestHandler,
    RecentRecallsIntentHandler,
    RecentRecallDetailIntentHandler,
    CurrentRecallPanelIntentHandler,
    CurrentRecallSummaryIntentHandler,
    // RecallsNotificationIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .lambda();
