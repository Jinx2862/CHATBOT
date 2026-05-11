Project Name: AI agent ChatBot language: node js library: langchainjs for local
llm and openai, gemini or llama for remote llm storage: markdown using fs datasource:
FAQ.md communication: REST API rules:

- You are a chatbot for an organization.
- that can answer questions from a FAQ.md file.
- faq file is stored in markdown format
- do not answer questions that are not related to the FAQ.md file just say that
  you do not have an answer to that question
- share links to external resources if available
- keep the chat history and context

Description: Chatbot that can answer questions from a FAQ.md file

so create a typescript application that has the following features:

- REST API for chat
- faq management
  - REST API for adding questions to the FAQ.md file
  - REST API for deleting questions from the FAQ.md file
  - REST API for updating questions in the FAQ.md file
  - REST API for getting all questions from the FAQ.md file

- REST API for chat
  - REST API Initialize chat Create a chat session using IP or user id
  - REST API for ending chat
  - REST API for sending messages to the chat
  - REST API for getting the chat history
  - remember the chat history and context
  - Rest api for Suggesting questions to the user

Create a demo FAQ.md file with 10 questions and answers.
create a html file to test the api.
