# Student API

This project is a simple RESTful API for managing student data. It allows you to retrieve information about students, including their names, phone numbers, guardian phone numbers, and class information.

## Project Structure

```
student-api
├── src
│   ├── app.ts                  # Entry point of the application
│   ├── controllers
│   │   └── studentsController.ts # Handles API requests related to students
│   ├── routes
│   │   └── students.ts         # Defines routes for the student API
│   └── types
│       └── student.ts          # Defines the structure of a student object
├── package.json                # NPM configuration file
├── tsconfig.json               # TypeScript configuration file
└── README.md                   # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd student-api
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the application:**
   ```bash
   npm start
   ```

## API Usage

### Get All Students

- **Endpoint:** `GET /students`
- **Description:** Retrieves a list of all students with their names, phone numbers, guardian phone numbers, and class information.
- **Response:**
  - Status: 200 OK
  - Body: An array of student objects.

### Example Response

```json
[
  {
    "name": "John Doe",
    "phone": "123-456-7890",
    "guardianPhone": "098-765-4321",
    "class": "10A"
  },
  {
    "name": "Jane Smith",
    "phone": "234-567-8901",
    "guardianPhone": "876-543-2109",
    "class": "10B"
  }
]
```

## License

This project is licensed under the MIT License.